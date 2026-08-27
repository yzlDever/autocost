import { requireApiSession } from "@/lib/api";
import { DingTalkDirectoryError, fetchDingTalkDirectory } from "@/lib/dingtalk";
import { recordAudit, syncDingTalkDirectory } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  const sourceIp = getRequestIp(request.headers);
  try {
    const directory = await fetchDingTalkDirectory();
    const result = await syncDingTalkDirectory(directory, auth.session.username, sourceIp);
    return Response.json({ success: true, result });
  } catch (error) {
    const knownError = error instanceof DingTalkDirectoryError ? error : null;
    const message = knownError?.message ?? "钉钉通讯录同步失败，请稍后重试。";
    await recordAudit({
      actor: auth.session.username,
      action: "directory.sync.failed",
      objectType: "employee_directory",
      objectId: "dingtalk",
      summary: message,
      sourceIp,
    });
    const status = knownError?.code === "DINGTALK_DIRECTORY_PERMISSION_DENIED"
      ? 403
      : knownError?.code === "DINGTALK_DIRECTORY_NOT_CONFIGURED"
        ? 503
        : 502;
    return Response.json({ success: false, message }, { status });
  }
}
