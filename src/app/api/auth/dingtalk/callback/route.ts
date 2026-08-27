import {
  authenticateWithDingTalk,
  DingTalkAuthError,
  type DingTalkAuthErrorCode,
} from "@/lib/dingtalk";
import {
  clearOAuthStateCookie,
  getOAuthStateCookie,
  setSessionCookie,
  verifyOAuthStateToken,
} from "@/lib/session";
import { recordAudit } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

const loginErrorCodes: Record<DingTalkAuthErrorCode, string> = {
  DINGTALK_NOT_CONFIGURED: "dingtalk_not_configured",
  DINGTALK_AUTH_REJECTED: "dingtalk_rejected",
  DINGTALK_WRONG_ORG: "dingtalk_wrong_org",
  DINGTALK_NOT_MEMBER: "dingtalk_not_member",
  DINGTALK_NOT_ALLOWED: "dingtalk_not_allowed",
  DINGTALK_UPSTREAM_ERROR: "dingtalk_unavailable",
};

function loginRedirect(request: Request, error: string) {
  return Response.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url), 302);
}

export async function GET(request: Request) {
  const sourceIp = getRequestIp(request.headers);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");
  const oauthState = verifyOAuthStateToken(await getOAuthStateCookie(), state);
  await clearOAuthStateCookie();

  if (!oauthState) {
    await recordAudit({
      actor: "unknown",
      action: "auth.login.failed",
      objectType: "session",
      objectId: "dingtalk",
      summary: "钉钉登录状态校验失败。",
      sourceIp,
    });
    return loginRedirect(request, "dingtalk_state_invalid");
  }
  if (providerError || !code) {
    await recordAudit({
      actor: "unknown",
      action: "auth.login.failed",
      objectType: "session",
      objectId: "dingtalk",
      summary: "用户取消或钉钉拒绝了登录授权。",
      sourceIp,
    });
    return loginRedirect(request, "dingtalk_cancelled");
  }

  try {
    const identity = await authenticateWithDingTalk(code);
    await setSessionCookie({
      username: identity.name,
      provider: "dingtalk",
      dingtalkUserId: identity.userId,
    });
    await recordAudit({
      actor: identity.name,
      action: "auth.login.success",
      objectType: "session",
      objectId: identity.userId,
      summary: "钉钉扫码登录成功。",
      sourceIp,
    });
    return Response.redirect(new URL(oauthState.returnTo, request.url), 302);
  } catch (error) {
    const errorCode = error instanceof DingTalkAuthError
      ? loginErrorCodes[error.code]
      : "dingtalk_unavailable";
    await recordAudit({
      actor: "unknown",
      action: "auth.login.failed",
      objectType: "session",
      objectId: "dingtalk",
      summary: `钉钉登录失败：${errorCode}。`,
      sourceIp,
    });
    return loginRedirect(request, errorCode);
  }
}
