import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const payrollPath = process.env.PAYROLL_TEST_FILE;
if (!payrollPath) throw new Error("PAYROLL_TEST_FILE is required");
const statePath = process.env.ACCEPTANCE_STATE_PATH;
if (!statePath) throw new Error("ACCEPTANCE_STATE_PATH is required");

let cookie = "";
const checks = [];
let queryEmployeeIds = [];

async function checked(name, fn) {
  await fn();
  checks.push(name);
}

async function appFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${baseUrl}${url}`, { ...init, headers, redirect: "manual" });
}

async function json(response) {
  return response.json();
}

await checked("login page exposes DingTalk with a safe unconfigured state", async () => {
  const response = await appFetch("/login");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /钉钉扫码登录待配置/);
  assert.doesNotMatch(html, /DINGTALK_CLIENT_SECRET|clientSecret/);
});

await checked("unconfigured DingTalk entry redirects to a safe login error", async () => {
  const response = await appFetch("/api/auth/dingtalk");
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /\/login\?error=dingtalk_not_configured$/);
});

await checked("DingTalk callback rejects a missing OAuth state", async () => {
  const response = await appFetch("/api/auth/dingtalk/callback?code=untrusted-code&state=invalid");
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /\/login\?error=dingtalk_state_invalid$/);
});

await checked("login rejects wrong password", async () => {
  const response = await appFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  assert.equal(response.status, 401);
});

await checked("protected pages redirect before login", async () => {
  const response = await appFetch("/dashboard");
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login");
});

await checked("login succeeds with fixed test account", async () => {
  const response = await appFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  assert.equal(response.status, 200);
  cookie = response.headers.getSetCookie()[0].split(";")[0];
  assert.match(cookie, /^auto_cost_session=/);
});

for (const [route, text] of [
  ["/dashboard", "人力成本仪表盘"],
  ["/payroll", "工资管理"],
  ["/people", "人员管理"],
  ["/integrations", "接口管理"],
  ["/audit", "操作审计"],
]) {
  await checked(`${route} renders`, async () => {
    const response = await appFetch(route);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, new RegExp(text));
    if (route === "/people") assert.match(html, /下载工资模板/);
  });
}

await checked("successful and failed login attempts are audited without passwords", async () => {
  const response = await appFetch("/audit");
  const html = await response.text();
  assert.match(html, /固定账号登录失败/);
  assert.match(html, /固定账号登录成功/);
  assert.doesNotMatch(html, /admin123|wrong/);
});

const workbookBytes = await fs.readFile(payrollPath);
const createReferencePayrollForm = () => {
  const form = new FormData();
  form.set(
    "file",
    new File([workbookBytes], path.basename(payrollPath), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return form;
};

let systemWorkbookBytes;
await checked("system template contains every current and historical person with blank costs", async () => {
  const response = await appFetch("/api/payroll/template");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /spreadsheetml/);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
  const templateBytes = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(templateBytes, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  assert.equal(values[0][0], "工资期间");
  assert.equal(values[0][1], null);
  assert.deepEqual(values[2], ["人员ID", "工号", "姓名", "部门", "人员状态", "公司人力总成本"]);
  assert.equal(values.slice(3).length, 8);
  assert.equal(values.slice(3).every((row) => row[0] && row[5] === null), true);

  sheet.B1 = { t: "n", v: 202608 };
  values.slice(3).forEach((_, index) => {
    sheet[`F${index + 4}`] = { t: "n", v: 20000 + index * 1000 };
  });
  systemWorkbookBytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
});

const createSystemPayrollForm = () => {
  const form = new FormData();
  form.set("file", new File([systemWorkbookBytes], "autocost-system-template.xlsx"));
  return form;
};

await checked("system template previews with stable employee id matches", async () => {
  const response = await appFetch("/api/payroll/import?mode=preview", {
    method: "POST",
    body: createSystemPayrollForm(),
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.preview.format, "system_template");
  assert.equal(body.preview.period, "2026-08");
  assert.equal(body.preview.validRows, 8);
  assert.equal(body.preview.errorRows, 0);
  assert.equal(body.preview.rows.every((row) => row.employeeId), true);
});

const invalidWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  invalidWorkbook,
  XLSX.utils.aoa_to_sheet([
    ["期间", "姓名", "部门", "工号", "公司人力总成本"],
    [null, null, null, null, null],
    [202607, "测试甲", "财务部", "T001", 10000],
    [202608, "测试乙", "财务部", "T002", 12000],
    [202607, "测试甲", "财务部", "T003", 13000],
    [202607, "测试丙", "财务部", "T004", "#VALUE!"],
    [202607, "测试丁", "财务部", "T005", null],
  ]),
  "测试工资",
);
const invalidWorkbookBytes = XLSX.write(invalidWorkbook, { type: "buffer", bookType: "xlsx" });
const createInvalidPayrollForm = () => {
  const form = new FormData();
  form.set("file", new File([invalidWorkbookBytes], "invalid-payroll.xlsx"));
  return form;
};

await checked("invalid, duplicate and mixed-period payroll rows cannot commit", async () => {
  const previewResponse = await appFetch("/api/payroll/import?mode=preview", {
    method: "POST",
    body: createInvalidPayrollForm(),
  });
  const previewBody = await json(previewResponse);
  assert.equal(previewResponse.status, 200);
  assert.ok(previewBody.preview.errorRows >= 4);
  assert.match(JSON.stringify(previewBody.preview.errors), /姓名重复/);
  assert.match(JSON.stringify(previewBody.preview.errors), /有效数值/);
  assert.match(JSON.stringify(previewBody.preview.errors), /只能包含一个工资期间/);
  const commitResponse = await appFetch("/api/payroll/import?mode=commit", {
    method: "POST",
    body: createInvalidPayrollForm(),
  });
  assert.equal(commitResponse.status, 422);
});

await checked("system template commits without retaining source file", async () => {
  const response = await appFetch("/api/payroll/import?mode=commit", {
    method: "POST",
    body: createSystemPayrollForm(),
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.result.updatedCosts, 8);
  assert.equal(body.result.createdEmployees, 0);
  assert.equal(body.result.removedDemoEmployees, 0);
  assert.equal(body.result.sampleEmployeeIds.length, 2);
  queryEmployeeIds = body.result.sampleEmployeeIds;
  const persisted = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.deepEqual(Object.keys(persisted.imports[0]).sort(), [
    "actor", "createdAt", "errorRows", "fileName", "id", "period",
    "sha256", "status", "totalRows", "validRows",
  ]);
});

await checked("legacy reference workbook cannot create unmatched people", async () => {
  const previewResponse = await appFetch("/api/payroll/import?mode=preview", {
    method: "POST",
    body: createReferencePayrollForm(),
  });
  const previewBody = await json(previewResponse);
  assert.equal(previewResponse.status, 200);
  assert.equal(previewBody.preview.sheetName, "2607工资");
  assert.ok(previewBody.preview.errorRows > 0);
  assert.match(JSON.stringify(previewBody.preview.errors), /人员目录中找到匹配人员/);
  const commitResponse = await appFetch("/api/payroll/import?mode=commit", {
    method: "POST",
    body: createReferencePayrollForm(),
  });
  assert.equal(commitResponse.status, 422);
});

await checked("duplicate system workbook is rejected", async () => {
  const response = await appFetch("/api/payroll/import?mode=commit", {
    method: "POST",
    body: createSystemPayrollForm(),
  });
  const body = await json(response);
  assert.equal(response.status, 400);
  assert.match(body.message, /已经导入过/);
});

await checked("manual cost edit requires and records a reason", async () => {
  const missingReason = await appFetch("/api/payroll/cost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: queryEmployeeIds[0], period: "2026-08", amount: 20000, reason: "" }),
  });
  assert.equal(missingReason.status, 400);
  const response = await appFetch("/api/payroll/cost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: queryEmployeeIds[0], period: "2026-08", amount: 20000, reason: "端到端验收调整" }),
  });
  assert.equal(response.status, 200);
  const audit = await appFetch("/audit");
  assert.match(await audit.text(), /端到端验收调整/);
});

async function createClient(name) {
  const response = await appFetch("/api/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.match(body.key, /^ac_live_/);
  assert.equal("keyHash" in body.client, false);
  return { key: body.key, id: body.client.id };
}

const primaryClient = await createClient("验收经营分析系统");

async function queryCost(key, items) {
  const response = await fetch(`${baseUrl}/api/v1/labor-cost/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
  });
  return { response, body: await json(response) };
}

await checked("single-person and duplicate-person queries are rejected", async () => {
  const single = await queryCost(primaryClient.key, [
    { employeeId: queryEmployeeIds[0], from: "2026-07-01", to: "2026-07-31" },
  ]);
  assert.equal(single.body.errorCode, "MIN_PARTICIPANTS");
  const duplicate = await queryCost(primaryClient.key, [
    { employeeId: queryEmployeeIds[0], from: "2026-07-01", to: "2026-07-31" },
    { employeeId: queryEmployeeIds[0], from: "2026-07-01", to: "2026-07-31" },
  ]);
  assert.equal(duplicate.body.errorCode, "DUPLICATE_EMPLOYEE");
});

const validItems = [
  { employeeId: queryEmployeeIds[0], from: "2026-07-01", to: "2026-07-31" },
  { employeeId: queryEmployeeIds[1], from: "2026-07-01", to: "2026-07-31" },
];

await checked("valid query returns aggregate only", async () => {
  const { response, body } = await queryCost(primaryClient.key, validItems);
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.participantCount, 2);
  assert.equal(body.allocationMethod, "calendar_day");
  assert.equal(typeof body.totalCost, "number");
  assert.equal("items" in body, false);
  assert.equal("employeeId" in body, false);
  assert.equal("contributions" in body, false);
});

await checked("near-identical differencing query is blocked", async () => {
  const changed = [validItems[0], { ...validItems[1], to: "2026-07-30" }];
  const { body } = await queryCost(primaryClient.key, changed);
  assert.equal(body.errorCode, "DIFFERENCING_RISK");
});

const contributionClient = await createClient("贡献门槛验收系统");
await checked("low-contribution padding is blocked", async () => {
  const { body } = await queryCost(contributionClient.key, [
    { employeeId: queryEmployeeIds[0], from: "2026-07-01", to: "2026-07-01" },
    { employeeId: queryEmployeeIds[1], from: "2026-07-01", to: "2026-07-31" },
  ]);
  assert.equal(body.errorCode, "CONTRIBUTION_TOO_LOW");
});

await checked("disabled key becomes unauthorized", async () => {
  const response = await appFetch("/api/clients", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: contributionClient.id }),
  });
  assert.equal(response.status, 200);
  const disabled = await queryCost(contributionClient.key, validItems);
  assert.equal(disabled.response.status, 401);
  assert.equal(disabled.body.errorCode, "UNAUTHORIZED");
});

await checked("unconfigured directory sync is safe and query logs render", async () => {
  const sync = await appFetch("/api/people/sync", { method: "POST" });
  assert.equal(sync.status, 503);
  const syncBody = await sync.json();
  assert.equal(syncBody.success, false);
  assert.match(syncBody.message, /Client ID 和 Client Secret/);
  const logsPage = await appFetch("/integrations");
  const html = await logsPage.text();
  assert.match(html, /DIFFERENCING_RISK/);
  assert.match(html, /CONTRIBUTION_TOO_LOW/);
});

await checked("logout clears access", async () => {
  const response = await appFetch("/api/auth/logout", { method: "POST" });
  assert.equal(response.status, 200);
  cookie = "";
  const protectedPage = await appFetch("/dashboard");
  assert.equal(protectedPage.status, 307);
});

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
