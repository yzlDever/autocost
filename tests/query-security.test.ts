import assert from "node:assert/strict";
import test from "node:test";
import { hasDifferencingRisk, queryFingerprint } from "../src/lib/query-security";
import type { QueryItem, QueryLog } from "../src/lib/types";

const original: QueryItem[] = [
  { employeeId: "a", from: "2026-07-01", to: "2026-07-15" },
  { employeeId: "b", from: "2026-07-01", to: "2026-07-15" },
];

function log(items: QueryItem[]): QueryLog {
  return {
    id: "log",
    requestId: "req",
    clientId: "client",
    clientName: "test",
    sourceIp: "127.0.0.1",
    userAgent: "test",
    participantCount: items.length,
    totalDays: 30,
    fingerprint: queryFingerprint("client", items),
    queryItems: items,
    success: true,
    errorCode: null,
    reason: "ok",
    totalCostCents: 100,
    durationMs: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
  };
}

const now = new Date("2026-08-26T01:00:00.000Z").getTime();

test("allows an exact repeat", () => {
  assert.equal(hasDifferencingRisk("client", original, [log(original)], now), false);
});

test("rejects changing only one person's time range", () => {
  const changed = [original[0], { ...original[1], to: "2026-07-20" }];
  assert.equal(hasDifferencingRisk("client", changed, [log(original)], now), true);
});

test("rejects adding one person to an otherwise identical query", () => {
  const changed = [...original, { employeeId: "c", from: "2026-07-01", to: "2026-07-15" }];
  assert.equal(hasDifferencingRisk("client", changed, [log(original)], now), true);
});

test("does not compare queries from another client", () => {
  assert.equal(hasDifferencingRisk("other", original, [log(original)], now), false);
});
