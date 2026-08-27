import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import type {
  ApiClient,
  AuditEvent,
  ImportPreview,
  MonthlyCost,
  QueryLog,
  StoreState,
} from "./types";
import { applyDingTalkDirectorySnapshot, type DirectorySnapshot } from "./directory-sync";
import { createApiKey, createId, sha256 } from "./utils";

const LOCAL_STATE_PATH = process.env.LOCAL_DATA_PATH
  ? path.resolve(process.env.LOCAL_DATA_PATH)
  : path.join(process.cwd(), ".data", "auto-cost.json");

function createSeedState(): StoreState {
  const now = new Date().toISOString();
  const departments = ["研发中心", "研发中心", "销售中心", "销售中心", "财务部", "生产运营部", "生产运营部", "人力行政部"];
  const employees = departments.map((department, index) => ({
    id: `emp_demo_${String(index + 1).padStart(2, "0")}`,
    dingtalkUserId: `ding_demo_${String(index + 1).padStart(2, "0")}`,
    employeeNo: `D${String(index + 1).padStart(4, "0")}`,
    name: `演示员工${String(index + 1).padStart(2, "0")}`,
    department,
    status: "active" as const,
    source: "demo" as const,
    lastSyncedAt: now,
  }));
  const periods = [
    "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
    "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ];
  const monthlyCosts: MonthlyCost[] = [];
  periods.forEach((period, periodIndex) => {
    employees.forEach((employee, employeeIndex) => {
      const base = 15_000 + employeeIndex * 2_350;
      const trend = periodIndex * 140;
      const seasonal = periodIndex === 4 ? 3_500 : 0;
      monthlyCosts.push({
        employeeId: employee.id,
        employeeNameSnapshot: employee.name,
        departmentSnapshot: employee.department,
        period,
        amountCents: (base + trend + seasonal) * 100,
        version: 1,
        updatedBy: "system",
        updatedAt: now,
      });
    });
  });
  return {
    schemaVersion: 1,
    employees,
    monthlyCosts,
    imports: [],
    apiClients: [],
    queryLogs: [],
    auditEvents: [],
  };
}

function cloneState(state: StoreState): StoreState {
  return structuredClone(state);
}

async function readLocalState(): Promise<StoreState> {
  try {
    const content = await fs.readFile(LOCAL_STATE_PATH, "utf8");
    return JSON.parse(content) as StoreState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const seed = createSeedState();
    await fs.mkdir(path.dirname(LOCAL_STATE_PATH), { recursive: true });
    await fs.writeFile(LOCAL_STATE_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
}

async function writeLocalState(state: StoreState) {
  await fs.mkdir(path.dirname(LOCAL_STATE_PATH), { recursive: true });
  const tempPath = `${LOCAL_STATE_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2));
  await fs.rename(tempPath, LOCAL_STATE_PATH);
}

let sqlClient: ReturnType<typeof neon> | null = null;
let neonReady: Promise<void> | null = null;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATA_BACKEND=neon 时必须配置 DATABASE_URL。");
  }
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

async function ensureNeon() {
  if (!neonReady) {
    neonReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS auto_cost_state (
          id text PRIMARY KEY,
          version integer NOT NULL,
          payload jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      const seed = JSON.stringify(createSeedState());
      await sql`
        INSERT INTO auto_cost_state (id, version, payload)
        VALUES ('primary', 1, ${seed}::jsonb)
        ON CONFLICT (id) DO NOTHING
      `;
    })();
  }
  return neonReady;
}

function shouldUseNeon() {
  if (process.env.DATA_BACKEND === "neon") return true;
  if (process.env.DATA_BACKEND === "local" && process.env.NODE_ENV !== "production") {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    if (process.env.DATABASE_URL) return true;
    throw new Error("生产环境必须配置 DATABASE_URL，禁止使用临时文件保存工资数据。");
  }
  return false;
}

async function readNeonState() {
  await ensureNeon();
  const sql = getSql();
  const rows = (await sql`SELECT version, payload FROM auto_cost_state WHERE id = 'primary'`) as unknown as Array<{
    version: number;
    payload: StoreState;
  }>;
  const row = rows[0];
  if (!row) throw new Error("无法读取生产数据仓库。");
  return { version: Number(row.version), state: row.payload };
}

let localMutationQueue = Promise.resolve();

export async function getStoreState(): Promise<StoreState> {
  return shouldUseNeon() ? (await readNeonState()).state : readLocalState();
}

export async function mutateStore<T>(
  mutator: (draft: StoreState) => T | Promise<T>,
): Promise<T> {
  if (!shouldUseNeon()) {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason: unknown) => void;
    const resultPromise = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    localMutationQueue = localMutationQueue.then(async () => {
      try {
        const draft = cloneState(await readLocalState());
        const result = await mutator(draft);
        await writeLocalState(draft);
        resolveResult(result);
      } catch (error) {
        rejectResult(error);
      }
    });
    return resultPromise;
  }

  const sql = getSql();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readNeonState();
    const draft = cloneState(current.state);
    const result = await mutator(draft);
    const payload = JSON.stringify(draft);
    const updated = (await sql`
      UPDATE auto_cost_state
      SET payload = ${payload}::jsonb, version = version + 1, updated_at = now()
      WHERE id = 'primary' AND version = ${current.version}
      RETURNING version
    `) as unknown as Array<{ version: number }>;
    if (updated.length === 1) return result;
  }
  throw new Error("数据同时被其他请求修改，请重试。");
}

export function createAuditEvent(input: Omit<AuditEvent, "id" | "createdAt">): AuditEvent {
  return {
    ...input,
    id: createId("audit"),
    createdAt: new Date().toISOString(),
  };
}

export async function recordAudit(input: Omit<AuditEvent, "id" | "createdAt">) {
  return mutateStore((draft) => {
    const event = createAuditEvent(input);
    draft.auditEvents.unshift(event);
    draft.auditEvents = draft.auditEvents.slice(0, 5_000);
    return event;
  });
}

export async function commitPayrollImport(
  preview: ImportPreview,
  actor: string,
  sourceIp: string,
) {
  if (!preview.period || preview.errors.length > 0) {
    throw new Error("导入文件仍有错误，不能提交。");
  }
  const period = preview.period;
  return mutateStore((draft) => {
    if (draft.imports.some((item) => item.sha256 === preview.sha256 && item.status === "committed")) {
      throw new Error("该 Excel 文件已经导入过，不能重复提交。");
    }
    const now = new Date().toISOString();
    const demoEmployeeIds = new Set(
      draft.employees.filter((employee) => employee.source === "demo").map((employee) => employee.id),
    );
    if (demoEmployeeIds.size > 0 && draft.imports.length === 0) {
      draft.employees = draft.employees.filter((employee) => !demoEmployeeIds.has(employee.id));
      draft.monthlyCosts = draft.monthlyCosts.filter((cost) => !demoEmployeeIds.has(cost.employeeId));
    }
    let createdEmployees = 0;
    let updatedCosts = 0;
    const importedEmployeeIds: string[] = [];
    preview.rows.forEach((row) => {
      let employee = draft.employees.find((item) => item.name === row.name);
      if (!employee) {
        employee = {
          id: createId("emp"),
          dingtalkUserId: null,
          employeeNo: row.employeeNo,
          name: row.name,
          department: row.department,
          status: "active",
          source: "excel",
          lastSyncedAt: now,
        };
        draft.employees.push(employee);
        createdEmployees += 1;
      }
      importedEmployeeIds.push(employee.id);
      const existing = draft.monthlyCosts.find(
        (item) => item.employeeId === employee.id && item.period === row.period,
      );
      if (existing) {
        existing.amountCents = row.amountCents;
        existing.employeeNameSnapshot = employee.name;
        existing.departmentSnapshot = employee.department;
        existing.version += 1;
        existing.updatedBy = actor;
        existing.updatedAt = now;
      } else {
        draft.monthlyCosts.push({
          employeeId: employee.id,
          employeeNameSnapshot: employee.name,
          departmentSnapshot: employee.department,
          period: row.period,
          amountCents: row.amountCents,
          version: 1,
          updatedBy: actor,
          updatedAt: now,
        });
      }
      updatedCosts += 1;
    });
    const importId = createId("import");
    draft.imports.unshift({
      id: importId,
      fileName: preview.fileName,
      sha256: preview.sha256,
      period,
      totalRows: preview.totalRows,
      validRows: preview.validRows,
      errorRows: preview.errorRows,
      status: "committed",
      actor,
      createdAt: now,
    });
    draft.auditEvents.unshift(
      createAuditEvent({
        actor,
        action: "payroll.import",
        objectType: "payroll_import",
        objectId: importId,
        summary: `导入 ${preview.period} 工资：${updatedCosts} 条，新增人员 ${createdEmployees} 名。`,
        sourceIp,
      }),
    );
    return {
      importId,
      createdEmployees,
      updatedCosts,
      sampleEmployeeIds: importedEmployeeIds.slice(0, 2),
      removedDemoEmployees: demoEmployeeIds.size,
    };
  });
}

export async function updateMonthlyCost(input: {
  employeeId: string;
  period: string;
  amountCents: number;
  reason: string;
  actor: string;
  sourceIp: string;
}) {
  if (!input.reason.trim()) throw new Error("必须填写修改原因。");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error("金额必须是大于或等于 0 的有效数值。");
  }
  return mutateStore((draft) => {
    const cost = draft.monthlyCosts.find(
      (item) => item.employeeId === input.employeeId && item.period === input.period,
    );
    if (!cost) throw new Error("没有找到要修改的月度成本记录。");
    const before = cost.amountCents;
    cost.amountCents = input.amountCents;
    cost.version += 1;
    cost.updatedBy = input.actor;
    cost.updatedAt = new Date().toISOString();
    draft.auditEvents.unshift(
      createAuditEvent({
        actor: input.actor,
        action: "payroll.cost.update",
        objectType: "monthly_cost",
        objectId: `${input.employeeId}:${input.period}`,
        summary: `月度成本从 ¥${(before / 100).toFixed(2)} 修改为 ¥${(input.amountCents / 100).toFixed(2)}；原因：${input.reason.trim()}`,
        sourceIp: input.sourceIp,
      }),
    );
    return cost;
  });
}

export async function syncDemoDirectory(actor: string, sourceIp: string) {
  return mutateStore((draft) => {
    const now = new Date().toISOString();
    draft.employees.forEach((employee) => {
      employee.lastSyncedAt = now;
    });
    draft.auditEvents.unshift(
      createAuditEvent({
        actor,
        action: "directory.sync",
        objectType: "employee_directory",
        objectId: "demo",
        summary: `完成演示通讯录同步，共 ${draft.employees.length} 名人员。`,
        sourceIp,
      }),
    );
    return { count: draft.employees.length, syncedAt: now };
  });
}

export async function syncDingTalkDirectory(
  snapshot: DirectorySnapshot,
  actor: string,
  sourceIp: string,
) {
  return mutateStore((draft) => {
    const result = applyDingTalkDirectorySnapshot(draft, snapshot, new Date().toISOString());
    draft.auditEvents.unshift(
      createAuditEvent({
        actor,
        action: "directory.sync",
        objectType: "employee_directory",
        objectId: "dingtalk",
        summary: `完成钉钉通讯录同步，共 ${result.count} 名人员；新增 ${result.created} 名，关联 ${result.linked} 名，停用 ${result.inactivated} 名。`,
        sourceIp,
      }),
    );
    return result;
  });
}

export async function createApiClientRecord(name: string, actor: string, sourceIp: string) {
  if (!name.trim()) throw new Error("请填写来源系统名称。");
  const key = createApiKey();
  const now = new Date().toISOString();
  const record: ApiClient = {
    id: createId("client"),
    name: name.trim(),
    keyPrefix: key.slice(0, 12),
    keyHash: sha256(key),
    keyLastFour: key.slice(-4),
    status: "active",
    createdAt: now,
    lastUsedAt: null,
  };
  await mutateStore((draft) => {
    draft.apiClients.unshift(record);
    draft.auditEvents.unshift(
      createAuditEvent({
        actor,
        action: "api_client.create",
        objectType: "api_client",
        objectId: record.id,
        summary: `为“${record.name}”创建接口密钥 ${record.keyPrefix}••••${record.keyLastFour}。`,
        sourceIp,
      }),
    );
  });
  return { record, key };
}

export async function toggleApiClientRecord(
  id: string,
  actor: string,
  sourceIp: string,
) {
  return mutateStore((draft) => {
    const client = draft.apiClients.find((item) => item.id === id);
    if (!client) throw new Error("接口来源不存在。");
    client.status = client.status === "active" ? "inactive" : "active";
    draft.auditEvents.unshift(
      createAuditEvent({
        actor,
        action: "api_client.status.update",
        objectType: "api_client",
        objectId: client.id,
        summary: `接口来源“${client.name}”已${client.status === "active" ? "启用" : "停用"}。`,
        sourceIp,
      }),
    );
    return client;
  });
}

export async function findActiveApiClientByKey(key: string) {
  const keyHash = sha256(key);
  const state = await getStoreState();
  return state.apiClients.find(
    (item) => item.keyHash === keyHash && item.status === "active",
  ) ?? null;
}

export async function appendQueryLog(log: QueryLog) {
  return mutateStore((draft) => {
    draft.queryLogs.unshift(log);
    draft.queryLogs = draft.queryLogs.slice(0, 5_000);
    if (log.clientId) {
      const client = draft.apiClients.find((item) => item.id === log.clientId);
      if (client) client.lastUsedAt = log.createdAt;
    }
    return log;
  });
}

export function isProductionDatabaseConfigured() {
  return shouldUseNeon() && Boolean(process.env.DATABASE_URL);
}
