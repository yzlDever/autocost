import "server-only";

import type { ImportPreview } from "./types";
import { parsePayrollWorkbook } from "./payroll-workbook";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function parsePayrollFile(file: File): Promise<ImportPreview> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("只支持 .xlsx 文件。");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Excel 文件不能超过 10 MB。");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  return parsePayrollWorkbook(bytes, file.name);
}
