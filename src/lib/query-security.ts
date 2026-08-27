import type { QueryItem, QueryLog } from "./types";
import { sha256 } from "./utils";

export function normalizeQueryItems(items: QueryItem[]) {
  return items
    .map((item) => ({ ...item }))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

export function queryFingerprint(clientId: string, items: QueryItem[]) {
  return sha256(`${clientId}:${JSON.stringify(normalizeQueryItems(items))}`);
}

function sameRange(a: QueryItem, b: QueryItem) {
  return a.from === b.from && a.to === b.to;
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
    if (log.fingerprint === currentFingerprint) return false;
    const previous = normalizeQueryItems(log.queryItems);
    const previousById = new Map(previous.map((item) => [item.employeeId, item]));
    const currentById = new Map(current.map((item) => [item.employeeId, item]));
    const allIds = new Set([...previousById.keys(), ...currentById.keys()]);
    const changedIds = [...allIds].filter((id) => {
      const before = previousById.get(id);
      const after = currentById.get(id);
      if (!before || !after) return true;
      return !sameRange(before, after);
    });
    return changedIds.length === 1;
  });
}
