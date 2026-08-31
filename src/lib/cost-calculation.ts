import type { MonthlyCost, QueryItem } from "./types";

export type CalculationErrorCode =
  | "INVALID_DATE_RANGE"
  | "DUPLICATE_EMPLOYEE"
  | "MIN_PARTICIPANTS"
  | "EMPLOYEE_NOT_FOUND"
  | "MISSING_MONTHLY_COST"
  | "ZERO_CONTRIBUTION"
  | "CONTRIBUTION_TOO_LOW";

export class CalculationError extends Error {
  constructor(
    public readonly code: CalculationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type ParsedDate = {
  year: number;
  month: number;
  day: number;
  utc: number;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value: string): ParsedDate | null {
  const match = ISO_DATE.exec(value);
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
  ) {
    return null;
  }
  return { year, month, day, utc };
}

export function inclusiveDays(from: ParsedDate, to: ParsedDate) {
  return Math.floor((to.utc - from.utc) / 86_400_000) + 1;
}

export function periodOf(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function nextMonth(year: number, month: number) {
  return month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function validateQueryItems(items: QueryItem[], today = new Date()) {
  if (items.length < 2) {
    throw new CalculationError("MIN_PARTICIPANTS", "每次查询至少需要两名有效人员。");
  }

  const ids = new Set<string>();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  return items.map((item) => {
    if (!item.employeeId || ids.has(item.employeeId)) {
      throw new CalculationError(
        "DUPLICATE_EMPLOYEE",
        "钉钉人员编码不能为空，且同一个人员不能重复出现。",
      );
    }
    ids.add(item.employeeId);
    const from = parseDate(item.from);
    const to = parseDate(item.to);
    if (!from || !to || from.utc > to.utc) {
      throw new CalculationError("INVALID_DATE_RANGE", "查询日期格式或范围无效。");
    }
    const days = inclusiveDays(from, to);
    if (days < 1 || days > 366 || to.utc > todayUtc) {
      throw new CalculationError(
        "INVALID_DATE_RANGE",
        "查询区间必须为有效历史日期，且最长不超过 366 天。",
      );
    }
    return { item, from, to, days };
  });
}

export function calculateBatchCost(
  items: QueryItem[],
  existingEmployeeIds: Set<string>,
  monthlyCosts: MonthlyCost[],
  options: { today?: Date; minContributionRatio?: number } = {},
) {
  const normalized = validateQueryItems(items, options.today);
  const costMap = new Map(
    monthlyCosts.map((cost) => [`${cost.employeeId}:${cost.period}`, cost.amountCents]),
  );

  const contributions = normalized.map(({ item, from, to, days }) => {
    if (!existingEmployeeIds.has(item.employeeId)) {
      throw new CalculationError("EMPLOYEE_NOT_FOUND", "查询包含不存在的钉钉人员编码。");
    }

    let cursor = { year: from.year, month: from.month };
    let amountCents = 0;
    while (
      cursor.year < to.year ||
      (cursor.year === to.year && cursor.month <= to.month)
    ) {
      const period = periodOf(cursor.year, cursor.month);
      const monthlyAmount = costMap.get(`${item.employeeId}:${period}`);
      if (monthlyAmount === undefined) {
        throw new CalculationError(
          "MISSING_MONTHLY_COST",
          `查询范围内缺少 ${period} 月度成本数据。`,
        );
      }
      const monthStart = Date.UTC(cursor.year, cursor.month - 1, 1);
      const monthEnd = Date.UTC(cursor.year, cursor.month, 0);
      const overlapStart = Math.max(from.utc, monthStart);
      const overlapEnd = Math.min(to.utc, monthEnd);
      const overlapDays = Math.floor((overlapEnd - overlapStart) / 86_400_000) + 1;
      amountCents += (monthlyAmount * overlapDays) / daysInMonth(cursor.year, cursor.month);
      cursor = nextMonth(cursor.year, cursor.month);
    }
    if (amountCents <= 0) {
      throw new CalculationError("ZERO_CONTRIBUTION", "查询中存在成本贡献为零的人员。");
    }
    return { employeeId: item.employeeId, amountCents, days };
  });

  if (contributions.length < 2) {
    throw new CalculationError("MIN_PARTICIPANTS", "每次查询至少需要两名有效人员。");
  }
  const totalUnrounded = contributions.reduce((sum, item) => sum + item.amountCents, 0);
  const minimumRatio = options.minContributionRatio ?? 0.1;
  if (contributions.some((item) => item.amountCents / totalUnrounded < minimumRatio)) {
    throw new CalculationError(
      "CONTRIBUTION_TOO_LOW",
      `每名人员的成本贡献不得低于整批总额的 ${minimumRatio * 100}%。`,
    );
  }

  return {
    participantCount: contributions.length,
    totalDays: contributions.reduce((sum, item) => sum + item.days, 0),
    totalCostCents: Math.round(totalUnrounded),
  };
}
