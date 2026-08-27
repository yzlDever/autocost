import { createHash, randomBytes, randomUUID } from "node:crypto";

export const APP_TIME_ZONE = "Asia/Shanghai";

export function createId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function createApiKey() {
  return `ac_live_${randomBytes(24).toString("base64url")}`;
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function centsToYuan(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function getRequestIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "local"
  );
}

export function truncate(value: string, max = 96) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
