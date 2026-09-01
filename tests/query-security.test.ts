import assert from "node:assert/strict";
import test from "node:test";
import { hasDifferencingRisk, queryFingerprint } from "../src/lib/query-security";
import type { LegacyQueryItem, QueryItem, QueryLog } from "../src/lib/types";

const original: QueryItem[] = [
  { employeeId: "a", periods: [{ period: "2026-07", days: 15 }] },
  { employeeId: "b", periods: [{ period: "2026-07", days: 15 }] },
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
    queryVersion: 2,
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

test("allows an exact repeat regardless of item or period ordering", () => {
  const multiPeriod: QueryItem[] = [
    {
      employeeId: "a",
      periods: [
        { period: "2026-08", days: 5 },
        { period: "2026-07", days: 15 },
      ],
    },
    original[1],
  ];
  const reordered: QueryItem[] = [
    original[1],
    {
      employeeId: "a",
      periods: [
        { period: "2026-07", days: 15 },
        { period: "2026-08", days: 5 },
      ],
    },
  ];
  assert.equal(hasDifferencingRisk("client", reordered, [log(multiPeriod)], now), false);
});

test("rejects changing only one person's month days", () => {
  const changed = [original[0], { ...original[1], periods: [{ period: "2026-07", days: 14 }] }];
  assert.equal(hasDifferencingRisk("client", changed, [log(original)], now), true);
});

test("rejects adding one person to an otherwise identical query", () => {
  const changed = [...original, { employeeId: "c", periods: [{ period: "2026-07", days: 15 }] }];
  assert.equal(hasDifferencingRisk("client", changed, [log(original)], now), true);
});

test("does not compare queries from another client", () => {
  assert.equal(hasDifferencingRisk("other", original, [log(original)], now), false);
});

test("blocks an equivalent historical v1 range during the 24-hour migration window", () => {
  const legacyItems: LegacyQueryItem[] = [
    { employeeId: "a", from: "2026-07-01", to: "2026-07-15" },
    { employeeId: "b", from: "2026-07-01", to: "2026-07-15" },
  ];
  const legacyLog: QueryLog = { ...log(original), queryVersion: 1, queryItems: legacyItems };
  assert.equal(hasDifferencingRisk("client", original, [legacyLog], now), true);
});
