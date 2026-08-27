import assert from "node:assert/strict";
import test from "node:test";
import { CalculationError, calculateBatchCost } from "../src/lib/cost-calculation";
import type { MonthlyCost, QueryItem } from "../src/lib/types";

const employees = new Set(["a", "b", "c"]);

function costs(entries: Array<[string, string, number]>): MonthlyCost[] {
  return entries.map(([employeeId, period, amountCents]) => ({
    employeeId,
    period,
    amountCents,
    employeeNameSnapshot: employeeId,
    departmentSnapshot: "测试部",
    version: 1,
    updatedBy: "test",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }));
}

const today = new Date("2026-08-26T00:00:00.000Z");

test("full-month query returns only the aggregate total", () => {
  const result = calculateBatchCost(
    [
      { employeeId: "a", from: "2026-07-01", to: "2026-07-31" },
      { employeeId: "b", from: "2026-07-01", to: "2026-07-31" },
    ],
    employees,
    costs([["a", "2026-07", 310_000], ["b", "2026-07", 620_000]]),
    { today },
  );
  assert.deepEqual(result, { participantCount: 2, totalDays: 62, totalCostCents: 930_000 });
  assert.equal("contributions" in result, false);
});

test("partial month uses inclusive calendar-day allocation", () => {
  const result = calculateBatchCost(
    [
      { employeeId: "a", from: "2026-07-01", to: "2026-07-15" },
      { employeeId: "b", from: "2026-07-17", to: "2026-07-31" },
    ],
    employees,
    costs([["a", "2026-07", 310_000], ["b", "2026-07", 310_000]]),
    { today },
  );
  assert.equal(result.totalDays, 30);
  assert.equal(result.totalCostCents, 300_000);
});

test("cross-month allocation splits by calendar month", () => {
  const result = calculateBatchCost(
    [
      { employeeId: "a", from: "2026-06-16", to: "2026-07-15" },
      { employeeId: "b", from: "2026-06-16", to: "2026-07-15" },
    ],
    employees,
    costs([
      ["a", "2026-06", 300_000], ["a", "2026-07", 310_000],
      ["b", "2026-06", 300_000], ["b", "2026-07", 310_000],
    ]),
    { today },
  );
  assert.equal(result.totalCostCents, 600_000);
});

for (const scenario of [
  {
    name: "rejects a single participant",
    items: [{ employeeId: "a", from: "2026-07-01", to: "2026-07-31" }],
    code: "MIN_PARTICIPANTS",
  },
  {
    name: "rejects duplicate employees",
    items: [
      { employeeId: "a", from: "2026-07-01", to: "2026-07-31" },
      { employeeId: "a", from: "2026-07-01", to: "2026-07-31" },
    ],
    code: "DUPLICATE_EMPLOYEE",
  },
  {
    name: "rejects invalid dates",
    items: [
      { employeeId: "a", from: "2026-07-31", to: "2026-07-01" },
      { employeeId: "b", from: "2026-07-01", to: "2026-07-31" },
    ],
    code: "INVALID_DATE_RANGE",
  },
] satisfies Array<{ name: string; items: QueryItem[]; code: string }>) {
  test(scenario.name, () => {
    assert.throws(
      () => calculateBatchCost(scenario.items, employees, costs([["a", "2026-07", 300_000], ["b", "2026-07", 300_000]]), { today }),
      (error: unknown) => error instanceof CalculationError && error.code === scenario.code,
    );
  });
}

test("rejects missing monthly cost", () => {
  assert.throws(
    () => calculateBatchCost(
      [
        { employeeId: "a", from: "2026-07-01", to: "2026-07-31" },
        { employeeId: "b", from: "2026-07-01", to: "2026-07-31" },
      ],
      employees,
      costs([["a", "2026-07", 300_000]]),
      { today },
    ),
    (error: unknown) => error instanceof CalculationError && error.code === "MISSING_MONTHLY_COST",
  );
});

test("rejects a participant below the 10 percent contribution floor", () => {
  assert.throws(
    () => calculateBatchCost(
      [
        { employeeId: "a", from: "2026-07-01", to: "2026-07-31" },
        { employeeId: "b", from: "2026-07-01", to: "2026-07-31" },
      ],
      employees,
      costs([["a", "2026-07", 1_000], ["b", "2026-07", 100_000]]),
      { today },
    ),
    (error: unknown) => error instanceof CalculationError && error.code === "CONTRIBUTION_TOO_LOW",
  );
});
