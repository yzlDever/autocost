import * as XLSX from "xlsx";
import type { Employee, ImportError, ImportPreview, ImportRow } from "./types";
import { sha256 } from "./utils";

export const PAYROLL_TEMPLATE_SHEET = "工资导入模板";

const SYSTEM_HEADERS = [
  "人员ID",
  "工号",
  "姓名",
  "部门",
  "人员状态",
  "公司人力总成本",
] as const;

function normalizePeriod(value: unknown): string | null {
  const normalized = String(value ?? "").replace(/[^0-9]/g, "");
  if (normalized.length !== 6) return null;
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4));
  if (year < 2000 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function toCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function readCell(row: unknown[], index: number) {
  return index >= 0 ? row[index] : null;
}

function readText(row: unknown[], index: number) {
  const value = readCell(row, index);
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeDepartment(value: string) {
  return value && !value.startsWith("#") ? value : "待同步部门";
}

function templateStatus(employee: Employee) {
  return employee.status === "active" ? "在职" : "离职";
}

export function buildPayrollTemplate(employees: Employee[], generatedAt = new Date()) {
  const sorted = [...employees].sort((left, right) => {
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    return left.department.localeCompare(right.department, "zh-CN") ||
      left.name.localeCompare(right.name, "zh-CN");
  });
  const rows: Array<Array<string | number | null>> = [
    [
      "工资期间",
      null,
      "填写说明",
      "在 B1 填写 YYYYMM；人员信息请勿修改；在最后一列填写公司人力总成本。离职人员本月无成本时可留空。",
      null,
      null,
    ],
    [null, null, null, null, null, null],
    [...SYSTEM_HEADERS],
    ...sorted.map((employee) => [
      employee.id,
      employee.employeeNo,
      employee.name,
      employee.department,
      templateStatus(employee),
      null,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
    { wch: 26 },
    { wch: 12 },
    { wch: 20 },
  ];
  sheet["!rows"] = [{ hpt: 34 }, { hpt: 8 }, { hpt: 24 }];
  sheet["!merges"] = [XLSX.utils.decode_range("D1:F1")];
  sheet["!autofilter"] = { ref: `A3:F${Math.max(3, rows.length)}` };

  const instructions = XLSX.utils.aoa_to_sheet([
    ["AutoCost 工资导入模板"],
    ["1", "在“工资导入模板”工作表的 B1 填写工资期间，格式为 YYYYMM。"],
    ["2", "人员 ID、工号、姓名、部门和人员状态由系统生成，请勿修改。"],
    ["3", "在“公司人力总成本”列填写大于或等于 0 的数值。"],
    ["4", "在职人员必须填写；离职人员本月没有成本时可以留空，有离职结算时仍可填写。"],
    ["5", "系统按人员 ID 精确关联，不会因为同名、改名或部门调整串改历史工资。"],
    ["生成时间", generatedAt.toISOString()],
  ]);
  instructions["!cols"] = [{ wch: 16 }, { wch: 86 }];

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "AutoCost 工资导入模板",
    Subject: "按稳定人员 ID 导入月度人力成本",
    Author: "AutoCost",
    CreatedDate: generatedAt,
  };
  XLSX.utils.book_append_sheet(workbook, sheet, PAYROLL_TEMPLATE_SHEET);
  XLSX.utils.book_append_sheet(workbook, instructions, "填写说明");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
}

export function parsePayrollWorkbook(bytes: Buffer, fileName: string): ImportPreview {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 中没有可读取的工作表。");
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const systemTemplate = String(matrix[0]?.[0] ?? "").trim() === "工资期间";
  const format = systemTemplate ? "system_template" : "legacy";
  const headerRowIndex = systemTemplate ? 2 : 0;
  const dataStartIndex = systemTemplate ? 3 : 2;
  const header = (matrix[headerRowIndex] ?? []).map((value) => String(value ?? "").trim());
  const employeeIdColumn = header.indexOf("人员ID");
  const periodColumn = header.indexOf("期间");
  const nameColumn = header.indexOf("姓名");
  const departmentColumn = header.indexOf("部门");
  const statusColumn = header.indexOf("人员状态");
  const employeeNoColumn = header.indexOf("工号");
  const costColumn = header.indexOf("公司人力总成本");

  if (systemTemplate) {
    const missing = SYSTEM_HEADERS.filter((column) => !header.includes(column));
    if (missing.length > 0) {
      throw new Error(`系统模板缺少“${missing.join("”“")}”列，请重新下载模板。`);
    }
  } else if (periodColumn < 0 || nameColumn < 0 || costColumn < 0) {
    throw new Error("首个工作表缺少“期间”“姓名”或“公司人力总成本”列。");
  }

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seenLegacyNames = new Set<string>();
  const seenEmployeeIds = new Set<string>();
  const periods = new Set<string>();
  const templatePeriod = systemTemplate ? normalizePeriod(matrix[0]?.[1]) : null;

  matrix.slice(dataStartIndex).forEach((row, index) => {
    const sourceRow = index + dataStartIndex + 1;
    const employeeId = readText(row, employeeIdColumn) || null;
    const employeeNo = readText(row, employeeNoColumn) || null;
    const name = readText(row, nameColumn);
    const department = normalizeDepartment(readText(row, departmentColumn));
    const status = readText(row, statusColumn);
    const rawAmount = readCell(row, costColumn);
    const hasAmount = rawAmount !== null && rawAmount !== undefined && rawAmount !== "";
    const rawPeriod = systemTemplate ? matrix[0]?.[1] : readCell(row, periodColumn);
    const period = systemTemplate ? templatePeriod : normalizePeriod(rawPeriod);

    if (systemTemplate && !employeeId && !name && !hasAmount) return;
    if (!systemTemplate && (rawPeriod === null || rawPeriod === undefined || rawPeriod === "")) return;
    if (!name && !employeeId && !period) return;
    if (systemTemplate && !hasAmount && status === "离职") return;
    if (!name) {
      errors.push({ sourceRow, name: "未命名人员", message: "姓名不能为空。" });
      return;
    }
    if (systemTemplate && !employeeId) {
      errors.push({ sourceRow, name, message: "人员ID不能为空，请重新下载系统模板。" });
      return;
    }
    if (!period) {
      if (!systemTemplate) errors.push({ sourceRow, name, message: "期间必须为 YYYYMM。" });
      return;
    }
    const amountCents = toCents(rawAmount);
    if (amountCents === null) {
      errors.push({
        sourceRow,
        name,
        message: "公司人力总成本必须是大于或等于 0 的有效数值。",
      });
      return;
    }
    if (employeeId) {
      if (seenEmployeeIds.has(employeeId)) {
        errors.push({ sourceRow, name, message: "同一文件中人员ID重复。" });
        return;
      }
      seenEmployeeIds.add(employeeId);
    } else if (seenLegacyNames.has(name)) {
      errors.push({ sourceRow, name, message: "同一文件中姓名重复。" });
      return;
    } else {
      seenLegacyNames.add(name);
    }
    periods.add(period);
    rows.push({
      sourceRow,
      employeeId,
      employeeNo,
      name,
      department,
      period,
      amountCents,
    });
  });

  if (systemTemplate && !templatePeriod) {
    errors.push({ sourceRow: 1, name: "整份文件", message: "请在 B1 填写 YYYYMM 格式的工资期间。" });
  }
  if (periods.size > 1) {
    errors.push({ sourceRow: 0, name: "整份文件", message: "一个文件只能包含一个工资期间。" });
  }
  const period = periods.size === 1 ? [...periods][0] : templatePeriod;
  return {
    fileName,
    sha256: sha256(bytes),
    sheetName,
    format,
    period,
    totalRows: rows.length + errors.filter((item) => item.sourceRow > 0).length,
    validRows: rows.length,
    errorRows: errors.length,
    rows,
    errors,
  };
}
