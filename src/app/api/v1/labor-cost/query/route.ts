import { CalculationError, calculateBatchCost, validateQueryItems } from "@/lib/cost-calculation";
import { hasDifferencingRisk, queryFingerprint } from "@/lib/query-security";
import {
  appendQueryLog,
  findActiveApiClientByKey,
  getStoreState,
} from "@/lib/store";
import type { QueryItem, QueryLog } from "@/lib/types";
import { centsToYuan, createId, getRequestIp, sha256 } from "@/lib/utils";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
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
  let fingerprint = sha256(`${client.id}:invalid`);
  let totalDays = 0;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiRequestError("INVALID_JSON", "请求 JSON 格式无效。");
    }
    const rawItems = (body as { items?: unknown })?.items;
    if (!Array.isArray(rawItems) || rawItems.length > 50) {
      throw new ApiRequestError("INVALID_JSON", "items 必须是包含 2 至 50 项的数组。");
    }
    items = rawItems.map((raw) => {
      if (!raw || typeof raw !== "object") {
        throw new ApiRequestError("INVALID_JSON", "items 中的每一项都必须是对象。");
      }
      const item = raw as Record<string, unknown>;
      if (
        typeof item.employeeId !== "string" ||
        typeof item.from !== "string" ||
        typeof item.to !== "string"
      ) {
        throw new ApiRequestError(
          "INVALID_JSON",
          "employeeId（钉钉人员编码）、from 和 to 必须是字符串。",
        );
      }
      return { employeeId: item.employeeId, from: item.from, to: item.to };
    });
    fingerprint = queryFingerprint(client.id, items);
    totalDays = validateQueryItems(items).reduce((sum, item) => sum + item.days, 0);
    const state = await getStoreState();
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
      allocationMethod: "calendar_day",
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
