import "server-only";

import type { DirectoryPerson, DirectorySnapshot } from "./directory-sync";
import {
  isDingTalkUserAllowed,
  parseDingTalkAllowedUserIds,
} from "./dingtalk-login-scope";

const DINGTALK_AUTHORIZE_URL = "https://login.dingtalk.com/oauth2/auth";
const DINGTALK_API_URL = "https://api.dingtalk.com";
const DINGTALK_LEGACY_API_URL = "https://oapi.dingtalk.com";
const REQUEST_TIMEOUT_MS = 20_000;
const DIRECTORY_CONCURRENCY = 6;
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60_000;

type DingTalkConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  corpId: string | null;
  allowedUserIds: Set<string>;
};

type DingTalkAppConfig = Pick<DingTalkConfig, "clientId" | "clientSecret">;

type CachedOrganizationToken = {
  clientId: string;
  accessToken: string;
  expiresAt: number;
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

export type DingTalkDirectoryErrorCode =
  | "DINGTALK_DIRECTORY_NOT_CONFIGURED"
  | "DINGTALK_DIRECTORY_PERMISSION_DENIED"
  | "DINGTALK_DIRECTORY_UPSTREAM_ERROR";

export class DingTalkDirectoryError extends Error {
  constructor(
    public readonly code: DingTalkDirectoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DingTalkDirectoryError";
  }
}

let organizationTokenCache: CachedOrganizationToken | null = null;
let organizationTokenPromise: Promise<string> | null = null;

export function isDingTalkAuthConfigured() {
  return Boolean(
    process.env.DINGTALK_CLIENT_ID?.trim() &&
    process.env.DINGTALK_CLIENT_SECRET?.trim() &&
    process.env.DINGTALK_REDIRECT_URI?.trim() &&
    parseDingTalkAllowedUserIds(process.env.DINGTALK_ALLOWED_USER_IDS).size > 0,
  );
}

export function isDingTalkDirectoryConfigured() {
  return Boolean(
    process.env.DINGTALK_CLIENT_ID?.trim() &&
    process.env.DINGTALK_CLIENT_SECRET?.trim(),
  );
}

function getDingTalkAppConfig(): DingTalkAppConfig {
  const clientId = process.env.DINGTALK_CLIENT_ID?.trim();
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new DingTalkDirectoryError(
      "DINGTALK_DIRECTORY_NOT_CONFIGURED",
      "钉钉通讯录尚未配置完整的 Client ID 和 Client Secret。",
    );
  }
  return { clientId, clientSecret };
}

export function getDingTalkConfig(): DingTalkConfig {
  const clientId = process.env.DINGTALK_CLIENT_ID?.trim();
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim();
  const redirectUri = process.env.DINGTALK_REDIRECT_URI?.trim();
  const allowedUserIds = parseDingTalkAllowedUserIds(process.env.DINGTALK_ALLOWED_USER_IDS);
  if (!clientId || !clientSecret || !redirectUri || allowedUserIds.size === 0) {
    throw new DingTalkAuthError(
      "DINGTALK_NOT_CONFIGURED",
      "钉钉登录尚未完成应用凭据、回调地址或登录范围配置。",
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

async function getOrganizationAccessToken(config: DingTalkAppConfig) {
  const now = Date.now();
  if (
    organizationTokenCache?.clientId === config.clientId &&
    organizationTokenCache.expiresAt - ACCESS_TOKEN_EXPIRY_BUFFER_MS > now
  ) {
    return organizationTokenCache.accessToken;
  }
  if (!organizationTokenPromise) {
    organizationTokenPromise = (async () => {
      const result = await postJson(`${DINGTALK_API_URL}/v1.0/oauth2/accessToken`, {
        appKey: config.clientId,
        appSecret: config.clientSecret,
      });
      const accessToken = String(result.accessToken ?? "");
      if (!accessToken) {
        throw new DingTalkAuthError("DINGTALK_UPSTREAM_ERROR", "钉钉未返回有效的应用凭证。");
      }
      const expiresInSeconds = Number(result.expireIn ?? 7200);
      organizationTokenCache = {
        clientId: config.clientId,
        accessToken,
        expiresAt: Date.now() + (
          Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
            ? expiresInSeconds
            : 7200
        ) * 1000,
      };
      return accessToken;
    })();
  }
  const pendingToken = organizationTokenPromise;
  try {
    return await pendingToken;
  } finally {
    if (organizationTokenPromise === pendingToken) organizationTokenPromise = null;
  }
}

function isPermissionError(result: Record<string, unknown>) {
  const message = `${result.errmsg ?? ""} ${result.message ?? ""}`.toLowerCase();
  return message.includes("permission") || message.includes("accessdenied") || message.includes("权限");
}

async function callDirectoryApi(
  accessToken: string,
  path: string,
  body: Record<string, unknown>,
) {
  const url = new URL(`${DINGTALK_LEGACY_API_URL}${path}`);
  url.searchParams.set("access_token", accessToken);
  let result: Record<string, unknown>;
  try {
    result = await postJson(url.toString(), body);
  } catch (error) {
    if (error instanceof DingTalkAuthError) {
      throw new DingTalkDirectoryError(
        "DINGTALK_DIRECTORY_UPSTREAM_ERROR",
        "无法连接钉钉通讯录服务。",
      );
    }
    throw error;
  }
  const errcode = Number(result.errcode ?? -1);
  if (errcode !== 0) {
    if (isPermissionError(result)) {
      throw new DingTalkDirectoryError(
        "DINGTALK_DIRECTORY_PERMISSION_DENIED",
        "钉钉应用缺少部门列表或部门成员读取权限。",
      );
    }
    throw new DingTalkDirectoryError(
      "DINGTALK_DIRECTORY_UPSTREAM_ERROR",
      `钉钉通讯录接口调用失败（错误码 ${Number.isFinite(errcode) ? errcode : "未知"}）。`,
    );
  }
  return result.result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asRecordArray(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function getDepartments(accessToken: string) {
  const departments = new Map<number, string>([[1, "全公司"]]);
  const queue = [1];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const batch: number[] = [];
    while (queue.length > 0 && batch.length < DIRECTORY_CONCURRENCY) {
      const departmentId = queue.shift();
      if (departmentId === undefined || visited.has(departmentId)) continue;
      visited.add(departmentId);
      batch.push(departmentId);
    }
    if (batch.length === 0) continue;
    if (visited.size > 10_000) {
      throw new DingTalkDirectoryError(
        "DINGTALK_DIRECTORY_UPSTREAM_ERROR",
        "钉钉返回的部门数量超过安全限制。",
      );
    }
    const results = await mapWithConcurrency(
      batch,
      DIRECTORY_CONCURRENCY,
      (departmentId) => callDirectoryApi(
        accessToken,
        "/topapi/v2/department/listsub",
        { dept_id: departmentId, language: "zh_CN" },
      ),
    );
    results.forEach((result) => {
      asRecordArray(result).forEach((department) => {
        const id = Number(department.dept_id);
        const name = String(department.name ?? "").trim();
        if (!Number.isFinite(id) || !name || departments.has(id)) return;
        departments.set(id, name);
        queue.push(id);
      });
    });
  }
  return departments;
}

async function getDepartmentPeople(accessToken: string, departmentId: number) {
  const people: DirectoryPerson[] = [];
  let cursor = 0;
  const seenCursors = new Set<number>();

  while (!seenCursors.has(cursor)) {
    seenCursors.add(cursor);
    const result = asRecord(await callDirectoryApi(
      accessToken,
      "/topapi/v2/user/list",
      { dept_id: departmentId, cursor, size: 100, language: "zh_CN" },
    ));
    asRecordArray(result.list).forEach((user) => {
      people.push({
        userId: String(user.userid ?? "").trim(),
        name: String(user.name ?? "").trim(),
        employeeNo: String(user.job_number ?? "").trim() || null,
        departmentIds: asNumberArray(user.dept_id_list),
      });
    });
    if (!result.has_more) break;
    const nextCursor = Number(result.next_cursor);
    if (!Number.isFinite(nextCursor)) {
      throw new DingTalkDirectoryError(
        "DINGTALK_DIRECTORY_UPSTREAM_ERROR",
        "钉钉通讯录分页信息无效。",
      );
    }
    if (nextCursor === cursor) {
      throw new DingTalkDirectoryError(
        "DINGTALK_DIRECTORY_UPSTREAM_ERROR",
        "钉钉通讯录分页游标没有继续前进。",
      );
    }
    cursor = nextCursor;
  }
  return people;
}

export async function fetchDingTalkDirectory(): Promise<DirectorySnapshot> {
  const config = getDingTalkAppConfig();
  let accessToken: string;
  try {
    accessToken = await getOrganizationAccessToken(config);
  } catch (error) {
    if (error instanceof DingTalkAuthError) {
      throw new DingTalkDirectoryError(
        "DINGTALK_DIRECTORY_UPSTREAM_ERROR",
        "钉钉应用凭证无效或访问凭证获取失败。",
      );
    }
    throw error;
  }
  const departments = await getDepartments(accessToken);
  const peopleByUserId = new Map<string, DirectoryPerson>();
  const departmentPeopleResults = await mapWithConcurrency(
    [...departments.keys()],
    DIRECTORY_CONCURRENCY,
    (departmentId) => getDepartmentPeople(accessToken, departmentId),
  );
  departmentPeopleResults.forEach((departmentPeople) => {
    departmentPeople.forEach((person) => {
      if (!person.userId || !person.name) return;
      const existing = peopleByUserId.get(person.userId);
      if (existing) {
        existing.departmentIds = [...new Set([...existing.departmentIds, ...person.departmentIds])];
        existing.employeeNo ||= person.employeeNo;
      } else {
        peopleByUserId.set(person.userId, person);
      }
    });
  });
  return { people: [...peopleByUserId.values()], departments };
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
  // 通配符只在 unionId 已成功映射为本企业当前有效 userId 后生效。
  const userId = await getOrganizationUserId(appAccessToken, currentUser.unionId);
  if (!isDingTalkUserAllowed(config.allowedUserIds, userId)) {
    throw new DingTalkAuthError("DINGTALK_NOT_ALLOWED", "当前用户不在系统登录范围中。");
  }
  return {
    userId,
    unionId: currentUser.unionId,
    name: currentUser.nick,
  };
}
