import { requireApiSession } from "@/lib/api";
import { buildPayrollTemplate } from "@/lib/payroll-workbook";
import { getStoreState, recordAudit } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;

  const state = await getStoreState();
  const now = new Date();
  const bytes = buildPayrollTemplate(state.employees, now);
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const fileName = `AutoCost工资导入模板-${date}.xlsx`;

  await recordAudit({
    actor: auth.session.username,
    action: "payroll.template.download",
    objectType: "payroll_template",
    objectId: date,
    summary: `下载工资导入模板，共包含 ${state.employees.length} 名在册及历史人员。`,
    sourceIp: getRequestIp(request.headers),
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="autocost-payroll-template-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
