import {
  CalculationError,
  calculateBatchCost,
  MAX_PERIODS_PER_EMPLOYEE,
  validateQueryItems,
} from "./cost-calculation";
import { hasDifferencingRisk, queryFingerprint } from "./query-security";
import {
  appendQueryLog,
  findActiveApiClientByKey,
  getStoreState,
} from "./store";
import type { QueryItem, QueryLog } from "./types";
import { centsToYuan, createId, getRequestIp, sha256 } from "./utils";

class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function createLog(input: Omit<QueryLog, "id" | "createdAt">): QueryLog {
  return { ...input, id: createId("qlog"), createdAt: new Date().toISOString() };
}

function jsonResponse(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseItems(body: unknown): QueryItem[] {
  const rawItems = (body as { items?: unknown })?.items;
  if (!Array.isArray(rawItems) || rawItems.length > 50) {
    throw new ApiRequestError("INVALID_JSON", "items 必须是包含 2 至 50 项的数组。");
  }

  return rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new ApiRequestError("INVALID_JSON", "items 中的每一项都必须是对象。");
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.employeeId !== "string" || !Array.isArray(item.periods)) {
      throw new ApiRequestError(
        "INVALID_JSON",
        "employeeId 必须是字符串，periods 必须是月份与天数数组。",
      );
    }
    if (item.periods.length > MAX_PERIODS_PER_EMPLOYEE) {
      throw new ApiRequestError(
        "INVALID_JSON",
        `每名人员最多支持 ${MAX_PERIODS_PER_EMPLOYEE} 个月份记录。`,
      );
    }
    const periods = item.periods.map((rawPeriod) => {
      if (!rawPeriod || typeof rawPeriod !== "object") {
        throw new ApiRequestError("INVALID_JSON", "periods 中的每一项都必须是对象。");
      }
      const entry = rawPeriod as Record<string, unknown>;
      if (typeof entry.period !== "string" || typeof entry.days !== "number") {
        throw new ApiRequestError(
          "INVALID_JSON",
          "period 必须是字符串，days 必须是数字。",
        );
      }
      return { period: entry.period.trim(), days: entry.days };
    });
    return { employeeId: item.employeeId.trim(), periods };
  });
}

export async function handleLaborCostQuery(request: Request) {
  const startedAt = Date.now();
  const requestId = createId("req");
  const sourceIp = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const authorization = request.headers.get("authorization") ?? "";
  const key = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const client = key ? await findActiveApiClientByKey(key) : null;

  if (!client) {
    await appendQueryLog(
      createLog({
        requestId,
        clientId: null,
        clientName: "未识别来源",
        sourceIp,
        userAgent,
        participantCount: 0,
        totalDays: 0,
        fingerprint: sha256(`unauthorized:${sourceIp}:${requestId}`),
        queryVersion: 2,
        queryItems: [],
        success: false,
        errorCode: "UNAUTHORIZED",
        reason: "Security 字符串无效或已停用。",
        totalCostCents: null,
        durationMs: Date.now() - startedAt,
      }),
    );
    return jsonResponse(
      { success: false, requestId, errorCode: "UNAUTHORIZED", message: "Security 字符串无效或已停用。" },
      401,
    );
  }

  let items: QueryItem[] = [];
  let fingerprint = sha256(`${client.id}:v2:invalid`);
  let totalDays = 0;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiRequestError("INVALID_JSON", "请求 JSON 格式无效。");
    }
    items = parseItems(body);
    totalDays = validateQueryItems(items).reduce((sum, item) => sum + item.days, 0);

    const state = await getStoreState();
    fingerprint = queryFingerprint(client.id, items);
    if (hasDifferencingRisk(client.id, items, state.queryLogs)) {
      throw new ApiRequestError(
        "DIFFERENCING_RISK",
        "该请求与近期查询高度相似，存在推算单人人力成本的风险。",
        409,
      );
    }

    const result = calculateBatchCost(
      items,
      new Set(state.employees.map((employee) => employee.id)),
      state.monthlyCosts,
    );
    totalDays = result.totalDays;
    await appendQueryLog(
      createLog({
        requestId,
        clientId: client.id,
        clientName: client.name,
        sourceIp,
        userAgent,
        participantCount: result.participantCount,
        totalDays: result.totalDays,
        fingerprint,
        queryVersion: 2,
        queryItems: items,
        success: true,
        errorCode: null,
        reason: "查询成功。",
        totalCostCents: result.totalCostCents,
        durationMs: Date.now() - startedAt,
      }),
    );
    return jsonResponse({
      requestId,
      success: true,
      participantCount: result.participantCount,
      allocationMethod: "fixed_23_workdays",
      currency: "CNY",
      totalCost: centsToYuan(result.totalCostCents),
    });
  } catch (error) {
    const code =
      error instanceof CalculationError || error instanceof ApiRequestError
        ? error.code
        : "INTERNAL_ERROR";
    const message = error instanceof Error ? error.message : "查询失败。";
    const status = error instanceof ApiRequestError ? error.status : error instanceof CalculationError ? 422 : 500;
    await appendQueryLog(
      createLog({
        requestId,
        clientId: client.id,
        clientName: client.name,
        sourceIp,
        userAgent,
        participantCount: new Set(items.map((item) => item.employeeId)).size,
        totalDays,
        fingerprint,
        queryVersion: 2,
        queryItems: items,
        success: false,
        errorCode: code,
        reason: message,
        totalCostCents: null,
        durationMs: Date.now() - startedAt,
      }),
    );
    return jsonResponse({ success: false, requestId, errorCode: code, message }, status);
  }
}
