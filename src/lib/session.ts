import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "auto_cost_session";
const DINGTALK_OAUTH_COOKIE_NAME = "auto_cost_dingtalk_oauth";
const SESSION_SECONDS = 8 * 60 * 60;
const OAUTH_STATE_SECONDS = 10 * 60;

export type SessionProvider = "credentials" | "dingtalk";

export type SessionIdentity = {
  username: string;
  provider: SessionProvider;
  dingtalkUserId?: string;
};

export type Session = SessionIdentity & {
  exp: number;
};

type OAuthState = {
  state: string;
  returnTo: string;
  exp: number;
};

function getAuthSecret() {
  const value = process.env.AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("生产环境缺少 DATABASE_URL，无法派生会话签名密钥。");
    return createHash("sha256")
      .update(`auto-cost/session/v1\0${databaseUrl}`)
      .digest("hex");
  }
  return "auto-cost-development-secret";
}

export function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (username && password) return { username, password };
  if (username || password) {
    throw new Error("ADMIN_USERNAME 和 ADMIN_PASSWORD 必须同时配置。");
  }
  return { username: "admin", password: "admin123" };
}

function sign(payload: string) {
  return createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
}

export function createSessionToken(identity: string | SessionIdentity) {
  const normalized: SessionIdentity = typeof identity === "string"
    ? { username: identity, provider: "credentials" }
    : identity;
  const session: Session = {
    ...normalized,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) return null;
  const expectedSignature = sign(payload);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Session>;
    const session: Session = {
      username: String(parsed.username ?? ""),
      provider: parsed.provider === "dingtalk" ? "dingtalk" : "credentials",
      ...(parsed.dingtalkUserId ? { dingtalkUserId: String(parsed.dingtalkUserId) } : {}),
      exp: Number(parsed.exp),
    };
    if (
      !session.username ||
      !Number.isFinite(session.exp) ||
      session.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function setSessionCookie(identity: string | SessionIdentity) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(identity), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
    priority: "high",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export function createOAuthState(returnTo = "/dashboard") {
  const state = randomBytes(32).toString("base64url");
  const value: OAuthState = {
    state,
    returnTo: returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard",
    exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return { state, token: `${payload}.${sign(payload)}` };
}

export function verifyOAuthStateToken(
  token: string | undefined,
  providedState: string | null,
): OAuthState | null {
  if (!token || !providedState) return null;
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) return null;
  const expectedSignature = sign(payload);
  const providedSignatureBuffer = Buffer.from(providedSignature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (
    providedSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)
  ) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    const expectedState = Buffer.from(String(value.state ?? ""));
    const actualState = Buffer.from(providedState);
    if (
      !value.returnTo?.startsWith("/") ||
      value.returnTo.startsWith("//") ||
      !Number.isFinite(value.exp) ||
      value.exp <= Math.floor(Date.now() / 1000) ||
      expectedState.length !== actualState.length ||
      !timingSafeEqual(expectedState, actualState)
    ) return null;
    return value;
  } catch {
    return null;
  }
}

export async function setOAuthStateCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(DINGTALK_OAUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/dingtalk",
    maxAge: OAUTH_STATE_SECONDS,
    priority: "high",
  });
}

export async function getOAuthStateCookie() {
  return (await cookies()).get(DINGTALK_OAUTH_COOKIE_NAME)?.value;
}

export async function clearOAuthStateCookie() {
  const cookieStore = await cookies();
  cookieStore.set(DINGTALK_OAUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/dingtalk",
    expires: new Date(0),
  });
}

export function credentialsMatch(input: string, expected: string) {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  return (
    inputBuffer.length === expectedBuffer.length &&
    timingSafeEqual(inputBuffer, expectedBuffer)
  );
}
