import { jsonError, requireApiSession } from "@/lib/api";
import { parsePayrollFile } from "@/lib/excel";
import { commitPayrollImport } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  const mode = new URL(request.url).searchParams.get("mode") ?? "preview";
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("请选择 Excel 文件。");
    const preview = await parsePayrollFile(file);
    if (mode === "preview") {
      return Response.json({
        success: true,
        preview: {
          ...preview,
          rows: preview.rows.slice(0, 12),
        },
      });
    }
    if (mode !== "commit") return jsonError("不支持的导入模式。");
    if (preview.errors.length > 0) {
      return Response.json({ success: false, message: "文件仍有错误，不能提交。", preview }, { status: 422 });
    }
    const result = await commitPayrollImport(
      preview,
      auth.session.username,
      getRequestIp(request.headers),
    );
    return Response.json({ success: true, result });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "导入失败。", 400);
  }
}
