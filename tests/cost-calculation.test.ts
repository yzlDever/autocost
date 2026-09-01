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

const today = new Date("2026-08-31T00:00:00.000Z");

test("23 workdays return the full monthly aggregate only", () => {
  const result = calculateBatchCost(
    [
      { employeeId: "a", periods: [{ period: "2026-07", days: 23 }] },
      { employeeId: "b", periods: [{ period: "2026-07", days: 23 }] },
    ],
    employees,
    costs([["a", "2026-07", 230_000], ["b", "2026-07", 460_000]]),
    { today },
  );
  assert.deepEqual(result, { participantCount: 2, totalDays: 46, totalCostCents: 690_000 });
  assert.equal("contributions" in result, false);
});

test("partial months always use the fixed 23-workday divisor", () => {
  const result = calculateBatchCost(
    [
      { employeeId: "a", periods: [{ period: "2026-07", days: 15 }] },
      { employeeId: "b", periods: [{ period: "2026-07", days: 8 }] },
    ],
    employees,
    costs([["a", "2026-07", 230_000], ["b", "2026-07", 460_000]]),
    { today },
  );
  assert.equal(result.totalDays, 23);
  assert.equal(result.totalCostCents, 310_000);
});

test("multiple months per person are summed before final rounding", () => {
  const result = calculateBatchCost(
    [
      {
        employeeId: "a",
        periods: [
          { period: "2026-07", days: 10 },
          { period: "2026-08", days: 5 },
        ],
      },
      { employeeId: "b", periods: [{ period: "2026-07", days: 23 }] },
    ],
    employees,
    costs([
      ["a", "2026-07", 230_000],
      ["a", "2026-08", 460_000],
      ["b", "2026-07", 230_000],
    ]),
    { today },
  );
  assert.equal(result.totalDays, 38);
  assert.equal(result.totalCostCents, 430_000);
});

for (const scenario of [
  {
    name: "rejects a single participant",
    items: [{ employeeId: "a", periods: [{ period: "2026-07", days: 23 }] }],
    code: "MIN_PARTICIPANTS",
  },
  {
    name: "rejects duplicate employees",
    items: [
      { employeeId: "a", periods: [{ period: "2026-07", days: 10 }] },
      { employeeId: "a", periods: [{ period: "2026-07", days: 12 }] },
    ],
    code: "DUPLICATE_EMPLOYEE",
  },
  {
    name: "rejects duplicate periods for one employee",
    items: [
      {
        employeeId: "a",
        periods: [
          { period: "2026-07", days: 10 },
          { period: "2026-07", days: 5 },
        ],
      },
      { employeeId: "b", periods: [{ period: "2026-07", days: 12 }] },
    ],
    code: "DUPLICATE_PERIOD",
  },
  {
    name: "rejects more than 23 workdays",
    items: [
      { employeeId: "a", periods: [{ period: "2026-07", days: 24 }] },
      { employeeId: "b", periods: [{ period: "2026-07", days: 12 }] },
    ],
    code: "INVALID_WORKDAYS",
  },
  {
    name: "rejects a future period",
    items: [
      { employeeId: "a", periods: [{ period: "2026-09", days: 10 }] },
      { employeeId: "b", periods: [{ period: "2026-07", days: 12 }] },
    ],
    code: "INVALID_PERIOD",
  },
] satisfies Array<{ name: string; items: QueryItem[]; code: string }>) {
  test(scenario.name, () => {
    assert.throws(
      () => calculateBatchCost(
        scenario.items,
        employees,
        costs([["a", "2026-07", 230_000], ["b", "2026-07", 230_000]]),
        { today },
      ),
      (error: unknown) => error instanceof CalculationError && error.code === scenario.code,
    );
  });
}

test("rejects missing monthly cost", () => {
  assert.throws(
    () => calculateBatchCost(
      [
        { employeeId: "a", periods: [{ period: "2026-07", days: 23 }] },
        { employeeId: "b", periods: [{ period: "2026-07", days: 23 }] },
      ],
      employees,
      costs([["a", "2026-07", 230_000]]),
      { today },
    ),
    (error: unknown) => error instanceof CalculationError && error.code === "MISSING_MONTHLY_COST",
  );
});

test("allows a participant below ten percent of the aggregate", () => {
  const result = calculateBatchCost(
    [
      { employeeId: "a", periods: [{ period: "2026-07", days: 1 }] },
      { employeeId: "b", periods: [{ period: "2026-07", days: 23 }] },
    ],
    employees,
    costs([["a", "2026-07", 1_000], ["b", "2026-07", 100_000]]),
    { today },
  );
  assert.equal(result.totalCostCents, 100_043);
});

test("uses Asia/Shanghai when validating the current period", () => {
  const result = calculateBatchCost(
    [
      { employeeId: "a", periods: [{ period: "2026-09", days: 1 }] },
      { employeeId: "b", periods: [{ period: "2026-09", days: 1 }] },
    ],
    employees,
    costs([["a", "2026-09", 230_000], ["b", "2026-09", 230_000]]),
    { today: new Date("2026-08-31T16:00:00.000Z") },
  );
  assert.equal(result.totalCostCents, 20_000);
});
