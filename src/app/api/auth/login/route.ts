import { getAdminCredentials, credentialsMatch, setSessionCookie } from "@/lib/session";
import { recordAudit } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  const sourceIp = getRequestIp(request.headers);
  const now = Date.now();
  const recent = (attempts.get(sourceIp) ?? []).filter((item) => now - item < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    await recordAudit({
      actor: "unknown",
      action: "auth.login.rate_limited",
      objectType: "session",
      objectId: "login",
      summary: "固定账号登录因失败次数过多被限流。",
      sourceIp,
    });
    return Response.json(
      { success: false, message: "登录失败次数过多，请 15 分钟后再试。" },
      { status: 429 },
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    await recordAudit({
      actor: "unknown",
      action: "auth.login.failed",
      objectType: "session",
      objectId: "login",
      summary: "固定账号登录请求格式无效。",
      sourceIp,
    });
    return Response.json({ success: false, message: "请求格式无效。" }, { status: 400 });
  }

  const expected = getAdminCredentials();
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  const success =
    credentialsMatch(username, expected.username) &&
    credentialsMatch(password, expected.password);

  if (!success) {
    recent.push(now);
    attempts.set(sourceIp, recent);
    await recordAudit({
      actor: username || "unknown",
      action: "auth.login.failed",
      objectType: "session",
      objectId: "login",
      summary: "固定账号登录失败。",
      sourceIp,
    });
    return Response.json({ success: false, message: "用户名或密码错误。" }, { status: 401 });
  }

  attempts.delete(sourceIp);
  await setSessionCookie(expected.username);
  await recordAudit({
    actor: expected.username,
    action: "auth.login.success",
    objectType: "session",
    objectId: "login",
    summary: "固定账号登录成功。",
    sourceIp,
  });
  return Response.json({ success: true });
}
