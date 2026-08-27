import { clearSessionCookie, getSession } from "@/lib/session";
import { recordAudit } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

export async function POST(request: Request) {
  const session = await getSession();
  if (session) {
    await recordAudit({
      actor: session.username,
      action: "auth.logout",
      objectType: "session",
      objectId: "logout",
      summary: "退出系统。",
      sourceIp: getRequestIp(request.headers),
    });
  }
  await clearSessionCookie();
  return Response.json({ success: true });
}
