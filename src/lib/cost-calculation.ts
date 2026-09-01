import type { MonthlyCost, QueryItem } from "./types";

export const STANDARD_MONTHLY_WORKDAYS = 23;
export const MAX_QUERY_PARTICIPANTS = 50;
export const MAX_PERIODS_PER_EMPLOYEE = 13;

export type CalculationErrorCode =
  | "INVALID_PERIODS"
  | "INVALID_PERIOD"
  | "INVALID_WORKDAYS"
  | "DUPLICATE_PERIOD"
  | "DUPLICATE_EMPLOYEE"
  | "MIN_PARTICIPANTS"
  | "MAX_PARTICIPANTS"
  | "EMPLOYEE_NOT_FOUND"
  | "MISSING_MONTHLY_COST"
  | "ZERO_CONTRIBUTION";

export class CalculationError extends Error {
  constructor(
    public readonly code: CalculationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const PERIOD_PATTERN = /^(\d{4})-(\d{2})$/;
const SHANGHAI_PERIOD_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
});

function currentPeriod(today: Date) {
  const parts = Object.fromEntries(
    SHANGHAI_PERIOD_FORMATTER.formatToParts(today).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}`;
}

function validatePeriod(value: string, today: Date) {
  const match = PERIOD_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2000 && month >= 1 && month <= 12 && value <= currentPeriod(today);
}

export function validateQueryItems(items: QueryItem[], today = new Date()) {
  if (items.length < 2) {
    throw new CalculationError("MIN_PARTICIPANTS", "每次查询至少需要两名有效人员。");
  }
  if (items.length > MAX_QUERY_PARTICIPANTS) {
    throw new CalculationError(
      "MAX_PARTICIPANTS",
      `每次查询最多支持 ${MAX_QUERY_PARTICIPANTS} 名人员。`,
    );
  }

  const employeeIds = new Set<string>();
  return items.map((item) => {
    if (!item.employeeId || employeeIds.has(item.employeeId)) {
      throw new CalculationError(
        "DUPLICATE_EMPLOYEE",
        "钉钉人员编码不能为空，且同一个人员不能重复出现。",
      );
    }
    employeeIds.add(item.employeeId);

    if (
      !Array.isArray(item.periods) ||
      item.periods.length < 1 ||
      item.periods.length > MAX_PERIODS_PER_EMPLOYEE
    ) {
      throw new CalculationError(
        "INVALID_PERIODS",
        `每名人员必须包含 1 至 ${MAX_PERIODS_PER_EMPLOYEE} 个月份记录。`,
      );
    }

    const periods = new Set<string>();
    const normalizedPeriods = item.periods.map((entry) => {
      if (!validatePeriod(entry.period, today)) {
        throw new CalculationError(
          "INVALID_PERIOD",
          "月份必须使用 YYYY-MM 格式，且不能晚于当前月份。",
        );
      }
      if (periods.has(entry.period)) {
        throw new CalculationError(
          "DUPLICATE_PERIOD",
          "同一个人员的同一个月份不能重复出现。",
        );
      }
      periods.add(entry.period);
      if (
        !Number.isInteger(entry.days) ||
        entry.days < 1 ||
        entry.days > STANDARD_MONTHLY_WORKDAYS
      ) {
        throw new CalculationError(
          "INVALID_WORKDAYS",
          `每个月的 days 必须是 1 至 ${STANDARD_MONTHLY_WORKDAYS} 的整数。`,
        );
      }
      return entry;
    });

    return {
      item: { ...item, periods: normalizedPeriods },
      days: normalizedPeriods.reduce((sum, entry) => sum + entry.days, 0),
    };
  });
}

export function calculateBatchCost(
  items: QueryItem[],
  existingEmployeeIds: Set<string>,
  monthlyCosts: MonthlyCost[],
  options: { today?: Date } = {},
) {
  const normalized = validateQueryItems(items, options.today);
  const costMap = new Map(
    monthlyCosts.map((cost) => [`${cost.employeeId}:${cost.period}`, cost.amountCents]),
  );

  const contributions = normalized.map(({ item, days }) => {
    if (!existingEmployeeIds.has(item.employeeId)) {
      throw new CalculationError("EMPLOYEE_NOT_FOUND", "查询包含不存在的钉钉人员编码。");
    }

    const amountCents = item.periods.reduce((sum, entry) => {
      const monthlyAmount = costMap.get(`${item.employeeId}:${entry.period}`);
      if (monthlyAmount === undefined) {
        throw new CalculationError(
          "MISSING_MONTHLY_COST",
          `查询范围内缺少 ${entry.period} 月度成本数据。`,
        );
      }
      return sum + (monthlyAmount * entry.days) / STANDARD_MONTHLY_WORKDAYS;
    }, 0);

    if (amountCents <= 0) {
      throw new CalculationError("ZERO_CONTRIBUTION", "查询中存在成本贡献为零的人员。");
    }
    return { amountCents, days };
  });

  return {
    participantCount: contributions.length,
    totalDays: contributions.reduce((sum, item) => sum + item.days, 0),
    totalCostCents: Math.round(
      contributions.reduce((sum, item) => sum + item.amountCents, 0),
    ),
  };
}
