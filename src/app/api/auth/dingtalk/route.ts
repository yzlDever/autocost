import { buildDingTalkAuthorizeUrl, getDingTalkConfig } from "@/lib/dingtalk";
import { createOAuthState, setOAuthStateCookie } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const config = getDingTalkConfig();
    const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/dashboard";
    const oauthState = createOAuthState(returnTo);
    await setOAuthStateCookie(oauthState.token);
    return Response.redirect(buildDingTalkAuthorizeUrl(config, oauthState.state), 302);
  } catch {
    return Response.redirect(new URL("/login?error=dingtalk_not_configured", request.url), 302);
  }
}
