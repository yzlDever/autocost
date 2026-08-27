import "server-only";

import * as XLSX from "xlsx";
import type { ImportError, ImportPreview, ImportRow } from "./types";
import { sha256 } from "./utils";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

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

export async function parsePayrollFile(file: File): Promise<ImportPreview> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("只支持 .xlsx 文件。");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Excel 文件不能超过 10 MB。");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 中没有可读取的工作表。");
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const header = matrix[0] ?? [];
  const periodColumn = header.indexOf("期间");
  const nameColumn = header.indexOf("姓名");
  const departmentColumn = header.indexOf("部门");
  const employeeNoColumn = header.indexOf("工号");
  const costColumn = header.indexOf("公司人力总成本");

  if (periodColumn < 0 || nameColumn < 0 || costColumn < 0) {
    throw new Error("首个工作表缺少“期间”“姓名”或“公司人力总成本”列。");
  }

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const names = new Set<string>();
  const periods = new Set<string>();

  matrix.slice(2).forEach((row, index) => {
    const sourceRow = index + 3;
    const rawPeriod = row[periodColumn];
    const rawName = row[nameColumn];
    const normalizedPeriod = normalizePeriod(rawPeriod);
    if (rawPeriod === null || rawPeriod === undefined || rawPeriod === "") return;
    if (!rawName && !normalizedPeriod) return;
    const name = String(rawName ?? "").trim();
    const period = normalizedPeriod;
    const amountCents = toCents(row[costColumn]);
    if (!name) {
      errors.push({ sourceRow, name: "未命名人员", message: "姓名不能为空。" });
      return;
    }
    if (!period) {
      errors.push({ sourceRow, name, message: "期间必须为 YYYYMM。" });
      return;
    }
    if (amountCents === null) {
      errors.push({
        sourceRow,
        name,
        message: "公司人力总成本必须是大于或等于 0 的有效数值。",
      });
      return;
    }
    if (names.has(name)) {
      errors.push({ sourceRow, name, message: "同一文件中姓名重复。" });
      return;
    }
    names.add(name);
    periods.add(period);
    rows.push({
      sourceRow,
      employeeNo:
        employeeNoColumn >= 0 && row[employeeNoColumn] !== null
          ? String(row[employeeNoColumn]).trim()
          : null,
      name,
      department:
        departmentColumn >= 0 &&
        row[departmentColumn] &&
        !String(row[departmentColumn]).startsWith("#")
          ? String(row[departmentColumn]).trim()
          : "待同步部门",
      period,
      amountCents,
    });
  });

  if (periods.size > 1) {
    errors.push({ sourceRow: 0, name: "整份文件", message: "一个文件只能包含一个工资期间。" });
  }
  const period = periods.size === 1 ? [...periods][0] : null;
  return {
    fileName: file.name,
    sha256: sha256(bytes),
    sheetName,
    period,
    totalRows: rows.length + errors.filter((item) => item.sourceRow > 0).length,
    validRows: rows.length,
    errorRows: errors.length,
    rows,
    errors,
  };
}
