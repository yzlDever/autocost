export function getDingTalkAuthorizationCode(searchParams: URLSearchParams) {
  // DingTalk documents `authCode`; keep `code` compatibility for clients
  // following the standard OAuth parameter name.
  return searchParams.get("authCode") ?? searchParams.get("code");
}
