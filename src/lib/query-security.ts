import type { LegacyQueryItem, QueryItem, QueryLog } from "./types";
import { sha256 } from "./utils";

export function normalizeQueryItems(items: QueryItem[]) {
  return items
    .map((item) => ({
      employeeId: item.employeeId,
      periods: [...item.periods].sort((a, b) => a.period.localeCompare(b.period)),
    }))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

export function queryFingerprint(clientId: string, items: QueryItem[]) {
  return sha256(`${clientId}:v2:${JSON.stringify(normalizeQueryItems(items))}`);
}

function samePeriods(a: QueryItem, b: QueryItem) {
  const left = [...a.periods].sort((x, y) => x.period.localeCompare(y.period));
  const right = [...b.periods].sort((x, y) => x.period.localeCompare(y.period));
  return left.length === right.length && left.every(
    (entry, index) =>
      entry.period === right[index]?.period && entry.days === right[index]?.days,
  );
}

function isV2Log(log: QueryLog): log is QueryLog & { queryVersion: 2; queryItems: QueryItem[] } {
  return log.queryVersion === 2;
}

function parseLegacyDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return { year, month, utc };
}

function normalizeLegacyQueryItems(items: LegacyQueryItem[]) {
  const normalized: QueryItem[] = [];
  for (const item of items) {
    const from = parseLegacyDate(item.from);
    const to = parseLegacyDate(item.to);
    if (!from || !to || from.utc > to.utc) return null;
    const periods: QueryItem["periods"] = [];
    let cursor = { year: from.year, month: from.month };
    while (cursor.year < to.year || (cursor.year === to.year && cursor.month <= to.month)) {
      const monthStart = Date.UTC(cursor.year, cursor.month - 1, 1);
      const monthEnd = Date.UTC(cursor.year, cursor.month, 0);
      const overlapStart = Math.max(from.utc, monthStart);
      const overlapEnd = Math.min(to.utc, monthEnd);
      periods.push({
        period: `${cursor.year}-${String(cursor.month).padStart(2, "0")}`,
        days: Math.floor((overlapEnd - overlapStart) / 86_400_000) + 1,
      });
      cursor = cursor.month === 12
        ? { year: cursor.year + 1, month: 1 }
        : { year: cursor.year, month: cursor.month + 1 };
    }
    normalized.push({ employeeId: item.employeeId, periods });
  }
  return normalizeQueryItems(normalized);
}

export function hasDifferencingRisk(
  clientId: string,
  items: QueryItem[],
  previousLogs: QueryLog[],
  now = Date.now(),
) {
  const current = normalizeQueryItems(items);
  const currentFingerprint = queryFingerprint(clientId, current);
  const recent = previousLogs.filter(
    (log) =>
      log.clientId === clientId &&
      log.success &&
      now - new Date(log.createdAt).getTime() < 24 * 60 * 60 * 1000,
  );

  return recent.some((log) => {
    if (isV2Log(log) && log.fingerprint === currentFingerprint) return false;
    const previous = isV2Log(log)
      ? normalizeQueryItems(log.queryItems)
      : normalizeLegacyQueryItems(log.queryItems as LegacyQueryItem[]);
    if (!previous) return true;
    const previousById = new Map(previous.map((item) => [item.employeeId, item]));
    const currentById = new Map(current.map((item) => [item.employeeId, item]));
    const allIds = new Set([...previousById.keys(), ...currentById.keys()]);
    const changedIds = [...allIds].filter((id) => {
      const before = previousById.get(id);
      const after = currentById.get(id);
      if (!before || !after) return true;
      return !samePeriods(before, after);
    });
    return isV2Log(log) ? changedIds.length === 1 : changedIds.length <= 1;
  });
}
