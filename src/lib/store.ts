import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import type {
  ApiClient,
  AuditEvent,
  ImportPreview,
  QueryLog,
  StoreState,
} from "./types";
import { applyDingTalkDirectorySnapshot, type DirectorySnapshot } from "./directory-sync";
import { matchPayrollPreview } from "./payroll-matching";
import {
  createEmptyStoreState,
  loadCurrentStoreState,
  purgeLegacyTestData,
} from "./store-state";
import { createApiKey, createId, sha256 } from "./utils";

const LOCAL_STATE_PATH = process.env.LOCAL_DATA_PATH
  ? path.resolve(process.env.LOCAL_DATA_PATH)
  : path.join(process.cwd(), ".data", "auto-cost.json");

function cloneState(state: StoreState): StoreState {
  return structuredClone(state);
}

async function readLocalState(): Promise<StoreState> {
  try {
    const content = await fs.readFile(LOCAL_STATE_PATH, "utf8");
    const loaded = loadCurrentStoreState(JSON.parse(content));
    const result = purgeLegacyTestData(loaded.state);
    if (loaded.reset || result.changed) await writeLocalState(result.state);
    return result.state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const seed = createEmptyStoreState();
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
      const seed = JSON.stringify(createEmptyStoreState());
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = (await sql`SELECT version, payload FROM auto_cost_state WHERE id = 'primary'`) as unknown as Array<{
      version: number;
      payload: StoreState;
    }>;
    const row = rows[0];
    if (!row) throw new Error("无法读取生产数据仓库。");
    const version = Number(row.version);
    const loaded = loadCurrentStoreState(row.payload);
    const result = purgeLegacyTestData(loaded.state);
    if (!loaded.reset && !result.changed) return { version, state: result.state };
    const payload = JSON.stringify(result.state);
    const updated = (await sql`
      UPDATE auto_cost_state
      SET payload = ${payload}::jsonb, version = version + 1, updated_at = now()
      WHERE id = 'primary' AND version = ${version}
      RETURNING version
    `) as unknown as Array<{ version: number }>;
    if (updated.length === 1) {
      return { version: Number(updated[0].version), state: result.state };
    }
  }
  throw new Error("清理历史演示数据时发生并发冲突，请重试。");
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
    const resolved = matchPayrollPreview(preview, draft.employees);
    if (resolved.errors.length > 0) {
      throw new Error(resolved.errors[0]?.message ?? "工资表人员匹配失败，请重新下载系统模板。");
    }
    const now = new Date().toISOString();
    let updatedCosts = 0;
    const importedEmployeeIds: string[] = [];
    resolved.rows.forEach((row) => {
      const employee = draft.employees.find((item) => item.id === row.employeeId);
      if (!employee) throw new Error("工资表包含已不存在的人员，请重新下载系统模板。");
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
      fileName: resolved.fileName,
      sha256: resolved.sha256,
      period,
      totalRows: resolved.totalRows,
      validRows: resolved.validRows,
      errorRows: resolved.errorRows,
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
        summary: `导入 ${resolved.period} 工资：${updatedCosts} 条，全部按钉钉人员编码关联。`,
        sourceIp,
      }),
    );
    return {
      importId,
      createdEmployees: 0,
      updatedCosts,
      sampleEmployeeIds: importedEmployeeIds.slice(0, 2),
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
        summary: `完成钉钉通讯录同步，共 ${result.count} 名人员；新增 ${result.created} 名，更新 ${result.updated} 名，停用 ${result.inactivated} 名。`,
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
