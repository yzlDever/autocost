import type { Employee, ImportPreview, ImportRow } from "./types";

function findUnique(items: Employee[]) {
  return items.length === 1 ? items[0] : null;
}

export function matchPayrollPreview(preview: ImportPreview, employees: Employee[]): ImportPreview {
  const errors = [...preview.errors];
  const matchedRows: ImportRow[] = [];
  const matchedEmployeeIds = new Set<string>();

  preview.rows.forEach((row) => {
    let employee: Employee | null = null;
    if (row.employeeId) {
      employee = employees.find((item) => item.id === row.employeeId) ?? null;
      if (!employee) {
        errors.push({
          sourceRow: row.sourceRow,
          name: row.name,
          message: "钉钉人员编码在当前系统中不存在，请重新同步通讯录并下载模板。",
        });
        return;
      }
      if (row.name !== employee.name || row.employeeNo !== employee.employeeNo) {
        errors.push({
          sourceRow: row.sourceRow,
          name: row.name,
          message: "钉钉人员编码与当前姓名或工号不一致，请重新下载最新模板。",
        });
        return;
      }
    } else if (row.employeeNo) {
      const byEmployeeNo = employees.filter((item) => item.employeeNo === row.employeeNo);
      if (byEmployeeNo.length > 1) {
        errors.push({
          sourceRow: row.sourceRow,
          name: row.name,
          message: "工号对应多名人员，不能自动匹配，请使用系统模板。",
        });
        return;
      }
      employee = findUnique(byEmployeeNo);
    }

    if (!employee) {
      const byName = employees.filter((item) => item.name === row.name);
      if (byName.length > 1) {
        errors.push({
          sourceRow: row.sourceRow,
          name: row.name,
          message: "姓名对应多名人员，不能自动匹配，请使用系统模板。",
        });
        return;
      }
      employee = findUnique(byName);
    }

    if (!employee) {
      errors.push({
        sourceRow: row.sourceRow,
        name: row.name,
        message: "未在人员目录中找到匹配人员，请先同步钉钉通讯录并重新下载模板。",
      });
      return;
    }
    if (matchedEmployeeIds.has(employee.id)) {
      errors.push({ sourceRow: row.sourceRow, name: employee.name, message: "同一人员在文件中重复。" });
      return;
    }
    matchedEmployeeIds.add(employee.id);
    matchedRows.push({
      ...row,
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      name: employee.name,
      department: employee.department,
    });
  });

  return {
    ...preview,
    validRows: matchedRows.length,
    errorRows: errors.length,
    rows: matchedRows,
    errors,
  };
}
