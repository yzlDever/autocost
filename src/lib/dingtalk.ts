import "server-only";

const DINGTALK_AUTHORIZE_URL = "https://login.dingtalk.com/oauth2/auth";
const DINGTALK_API_URL = "https://api.dingtalk.com";
const DINGTALK_LEGACY_API_URL = "https://oapi.dingtalk.com";
const REQUEST_TIMEOUT_MS = 12_000;

type DingTalkConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  corpId: string | null;
  allowedUserIds: Set<string>;
};

type DingTalkUserToken = {
  accessToken: string;
  corpId?: string;
};

type DingTalkCurrentUser = {
  unionId: string;
  nick: string;
};

export type DingTalkIdentity = {
  userId: string;
  unionId: string;
  name: string;
};

export type DingTalkAuthErrorCode =
  | "DINGTALK_NOT_CONFIGURED"
  | "DINGTALK_AUTH_REJECTED"
  | "DINGTALK_WRONG_ORG"
  | "DINGTALK_NOT_MEMBER"
  | "DINGTALK_NOT_ALLOWED"
  | "DINGTALK_UPSTREAM_ERROR";

export class DingTalkAuthError extends Error {
  constructor(public readonly code: DingTalkAuthErrorCode, message: string) {
    super(message);
    this.name = "DingTalkAuthError";
  }
}

function parseAllowedUserIds(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function isDingTalkAuthConfigured() {
  return Boolean(
    process.env.DINGTALK_CLIENT_ID?.trim() &&
    process.env.DINGTALK_CLIENT_SECRET?.trim() &&
    process.env.DINGTALK_REDIRECT_URI?.trim() &&
    parseAllowedUserIds(process.env.DINGTALK_ALLOWED_USER_IDS).size > 0,
  );
}

export function getDingTalkConfig(): DingTalkConfig {
  const clientId = process.env.DINGTALK_CLIENT_ID?.trim();
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim();
  const redirectUri = process.env.DINGTALK_REDIRECT_URI?.trim();
  const allowedUserIds = parseAllowedUserIds(process.env.DINGTALK_ALLOWED_USER_IDS);
  if (!clientId || !clientSecret || !redirectUri || allowedUserIds.size === 0) {
    throw new DingTalkAuthError(
      "DINGTALK_NOT_CONFIGURED",
      "钉钉登录尚未完成应用凭据、回调地址或财务白名单配置。",
    );
  }
  let parsedRedirectUri: URL;
  try {
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    throw new DingTalkAuthError("DINGTALK_NOT_CONFIGURED", "钉钉回调地址格式无效。");
  }
  if (!(["http:", "https:"].includes(parsedRedirectUri.protocol))) {
    throw new DingTalkAuthError("DINGTALK_NOT_CONFIGURED", "钉钉回调地址必须使用 HTTP 或 HTTPS。");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: parsedRedirectUri.toString(),
    corpId: process.env.DINGTALK_CORP_ID?.trim() || null,
    allowedUserIds,
  };
}

export function buildDingTalkAuthorizeUrl(config: DingTalkConfig, state: string) {
  const url = new URL(DINGTALK_AUTHORIZE_URL);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", "openid corpid");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url;
}

async function readJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new DingTalkAuthError("DINGTALK_UPSTREAM_ERROR", "钉钉返回了无法解析的响应。");
  }
}

async function postJson(url: string, body: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DingTalkAuthError("DINGTALK_UPSTREAM_ERROR", "无法连接钉钉身份服务。");
  }
  const result = await readJson(response);
  if (!response.ok) {
    throw new DingTalkAuthError("DINGTALK_UPSTREAM_ERROR", "钉钉身份服务拒绝了请求。");
  }
  return result;
}

async function exchangeUserToken(config: DingTalkConfig, code: string): Promise<DingTalkUserToken> {
  const result = await postJson(`${DINGTALK_API_URL}/v1.0/oauth2/userAccessToken`, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    grantType: "authorization_code",
  });
  const accessToken = String(result.accessToken ?? "");
  if (!accessToken) {
    throw new DingTalkAuthError("DINGTALK_AUTH_REJECTED", "钉钉未返回有效的用户凭证。");
  }
  return {
    accessToken,
    ...(result.corpId ? { corpId: String(result.corpId) } : {}),
  };
}

async function getCurrentUser(userAccessToken: string): Promise<DingTalkCurrentUser> {
  let response: Response;
  try {
    response = await fetch(`${DINGTALK_API_URL}/v1.0/contact/users/me`, {
      headers: { "x-acs-dingtalk-access-token": userAccessToken },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DingTalkAuthError("DINGTALK_UPSTREAM_ERROR", "无法读取钉钉登录用户信息。");
  }
  const result = await readJson(response);
  const unionId = String(result.unionId ?? "");
  if (!response.ok || !unionId) {
    throw new DingTalkAuthError("DINGTALK_AUTH_REJECTED", "无法确认钉钉登录用户身份。");
  }
  return { unionId, nick: String(result.nick ?? "钉钉用户") };
}

async function getOrganizationAccessToken(config: DingTalkConfig) {
  const result = await postJson(`${DINGTALK_API_URL}/v1.0/oauth2/accessToken`, {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });
  const accessToken = String(result.accessToken ?? "");
  if (!accessToken) {
    throw new DingTalkAuthError("DINGTALK_UPSTREAM_ERROR", "钉钉未返回有效的应用凭证。");
  }
  return accessToken;
}

async function getOrganizationUserId(accessToken: string, unionId: string) {
  const url = new URL(`${DINGTALK_LEGACY_API_URL}/topapi/user/getbyunionid`);
  url.searchParams.set("access_token", accessToken);
  const result = await postJson(url.toString(), { unionid: unionId });
  const errcode = Number(result.errcode ?? -1);
  const responseResult = result.result as Record<string, unknown> | undefined;
  const userId = String(responseResult?.userid ?? "");
  if (errcode !== 0 || !userId) {
    throw new DingTalkAuthError("DINGTALK_NOT_MEMBER", "当前用户不是该企业的有效成员。");
  }
  return userId;
}

export async function authenticateWithDingTalk(code: string): Promise<DingTalkIdentity> {
  const config = getDingTalkConfig();
  const userToken = await exchangeUserToken(config, code);
  if (config.corpId && userToken.corpId && userToken.corpId !== config.corpId) {
    throw new DingTalkAuthError("DINGTALK_WRONG_ORG", "请选择已配置的企业组织登录。");
  }
  const currentUser = await getCurrentUser(userToken.accessToken);
  const appAccessToken = await getOrganizationAccessToken(config);
  const userId = await getOrganizationUserId(appAccessToken, currentUser.unionId);
  if (!config.allowedUserIds.has(userId)) {
    throw new DingTalkAuthError("DINGTALK_NOT_ALLOWED", "当前用户不在财务登录白名单中。");
  }
  return {
    userId,
    unionId: currentUser.unionId,
    name: currentUser.nick,
  };
}
