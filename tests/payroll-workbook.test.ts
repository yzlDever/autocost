import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  buildPayrollTemplate,
  parsePayrollWorkbook,
} from "../src/lib/payroll-workbook";
import { matchPayrollPreview } from "../src/lib/payroll-matching";
import type { Employee } from "../src/lib/types";

const now = "2026-08-27T00:00:00.000Z";

function employee(input: Partial<Employee> & Pick<Employee, "id" | "name">): Employee {
  return {
    id: input.id,
    dingtalkUserId: input.dingtalkUserId ?? `ding-${input.id}`,
    employeeNo: input.employeeNo ?? null,
    name: input.name,
    department: input.department ?? "测试部",
    status: input.status ?? "active",
    source: input.source ?? "dingtalk",
    lastSyncedAt: input.lastSyncedAt ?? now,
  };
}

const directory = [
  employee({ id: "emp-active", employeeNo: "A001", name: "在职员工", department: "研发部" }),
  employee({ id: "emp-inactive", employeeNo: "A002", name: "离职员工", department: "历史部门", status: "inactive" }),
];

test("system template contains every known employee and leaves period and costs blank", () => {
  const bytes = buildPayrollTemplate(directory, new Date(now));
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  assert.equal(values[0]?.[0], "工资期间");
  assert.equal(values[0]?.[1], null);
  assert.deepEqual(values[2], ["人员ID", "工号", "姓名", "部门", "人员状态", "公司人力总成本"]);
  assert.deepEqual(values[3], ["emp-active", "A001", "在职员工", "研发部", "在职", null]);
  assert.deepEqual(values[4], ["emp-inactive", "A002", "离职员工", "历史部门", "离职", null]);
});

test("system template matches by stable employee id and preserves inactive monthly history", () => {
  const workbook = XLSX.read(buildPayrollTemplate(directory, new Date(now)), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  sheet.B1 = { t: "n", v: 202608 };
  sheet.F4 = { t: "n", v: 10000 };
  sheet.F5 = { t: "n", v: 2800 };
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const parsed = parsePayrollWorkbook(bytes, "system-template.xlsx");
  const matched = matchPayrollPreview(parsed, directory);

  assert.equal(matched.format, "system_template");
  assert.equal(matched.period, "2026-08");
  assert.equal(matched.errorRows, 0);
  assert.deepEqual(matched.rows.map((row) => row.employeeId), ["emp-active", "emp-inactive"]);
  assert.equal(matched.rows[0]?.name, "在职员工");
  assert.equal(matched.rows[1]?.amountCents, 280_000);
});

test("system template rejects a person id paired with a changed name or employee number", () => {
  const workbook = XLSX.read(buildPayrollTemplate(directory, new Date(now)), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  sheet.B1 = { t: "n", v: 202608 };
  sheet.C4 = { t: "s", v: "被修改的姓名" };
  sheet.F4 = { t: "n", v: 10000 };
  const parsed = parsePayrollWorkbook(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    "tampered-template.xlsx",
  );
  const matched = matchPayrollPreview(parsed, directory);

  assert.equal(matched.validRows, 0);
  assert.equal(matched.errorRows, 1);
  assert.match(matched.errors[0]?.message ?? "", /人员ID与当前姓名或工号不一致/);
});

test("blank inactive rows are optional but blank active rows are rejected", () => {
  const workbook = XLSX.read(buildPayrollTemplate(directory, new Date(now)), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  sheet.B1 = { t: "n", v: 202608 };
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = parsePayrollWorkbook(bytes, "blank-template.xlsx");

  assert.equal(parsed.validRows, 0);
  assert.equal(parsed.errorRows, 1);
  assert.match(parsed.errors[0]?.message ?? "", /有效数值/);
  assert.doesNotMatch(JSON.stringify(parsed.errors), /离职员工/);
});

test("legacy workbook uses a unique employee number before the name", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["期间", "工号", "姓名", "部门", "公司人力总成本"],
    [null, null, null, null, null],
    [202608, "A001", "工资表旧姓名", "旧部门", 12000],
  ]), "旧工资表");
  const parsed = parsePayrollWorkbook(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    "legacy.xlsx",
  );
  const matched = matchPayrollPreview(parsed, directory);

  assert.equal(matched.errorRows, 0);
  assert.equal(matched.rows[0]?.employeeId, "emp-active");
  assert.equal(matched.rows[0]?.name, "在职员工");
});

test("legacy workbook rejects an ambiguous employee number", () => {
  const employees = [
    employee({ id: "emp-1", employeeNo: "DUP", name: "甲" }),
    employee({ id: "emp-2", employeeNo: "DUP", name: "乙" }),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["期间", "工号", "姓名", "部门", "公司人力总成本"],
    [null, null, null, null, null],
    [202608, "DUP", "甲", "测试部", 10000],
  ]), "旧工资表");
  const parsed = parsePayrollWorkbook(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    "ambiguous.xlsx",
  );
  const matched = matchPayrollPreview(parsed, employees);

  assert.equal(matched.validRows, 0);
  assert.equal(matched.errorRows, 1);
  assert.match(matched.errors[0]?.message ?? "", /工号对应多名人员/);
});
