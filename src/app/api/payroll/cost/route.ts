import { jsonError, requireApiSession } from "@/lib/api";
import { updateMonthlyCost } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json()) as {
      employeeId?: string;
      period?: string;
      amount?: number;
      reason?: string;
    };
    if (!body.employeeId || !body.period || typeof body.amount !== "number") {
      return jsonError("人员、月份或金额无效。");
    }
    const result = await updateMonthlyCost({
      employeeId: body.employeeId,
      period: body.period,
      amountCents: Math.round(body.amount * 100),
      reason: body.reason ?? "",
      actor: auth.session.username,
      sourceIp: getRequestIp(request.headers),
    });
    return Response.json({ success: true, result });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "修改失败。");
  }
}
