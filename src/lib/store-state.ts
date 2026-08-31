import type { StoreState } from "./types";

export function createEmptyStoreState(): StoreState {
  return {
    schemaVersion: 2,
    employees: [],
    monthlyCosts: [],
    imports: [],
    apiClients: [],
    queryLogs: [],
    auditEvents: [],
  };
}

export function loadCurrentStoreState(value: unknown) {
  const schemaVersion = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (schemaVersion === 2) {
    return { state: value as StoreState, reset: false };
  }
  if (schemaVersion === 1) {
    return { state: createEmptyStoreState(), reset: true };
  }
  throw new Error("数据仓库版本无效，无法安全读取工资数据。");
}

export function purgeLegacyTestData(state: StoreState) {
  const demoEmployeeIds = new Set(
    state.employees
      .filter((employee) => {
        const source = (employee as { source?: string }).source;
        return source === "demo" || employee.id.startsWith("emp_demo_");
      })
      .map((employee) => employee.id),
  );
  state.monthlyCosts.forEach((cost) => {
    if (cost.employeeId.startsWith("emp_demo_")) demoEmployeeIds.add(cost.employeeId);
  });
  state.queryLogs.forEach((log) => {
    log.queryItems.forEach((item) => {
      if (item.employeeId.startsWith("emp_demo_")) demoEmployeeIds.add(item.employeeId);
    });
  });
  const isDemoAudit = (objectId: string, summary: string) =>
    objectId === "demo" || demoEmployeeIds.has(objectId) || summary.includes("演示");
  const changed = demoEmployeeIds.size > 0 || state.auditEvents.some(
    (event) => isDemoAudit(event.objectId, event.summary),
  );

  if (!changed) return { state, changed: false, removedEmployees: 0 };

  return {
    state: {
      ...state,
      employees: state.employees.filter((employee) => !demoEmployeeIds.has(employee.id)),
      monthlyCosts: state.monthlyCosts.filter((cost) => !demoEmployeeIds.has(cost.employeeId)),
      queryLogs: state.queryLogs.filter((log) =>
        log.queryItems.every((item) => !demoEmployeeIds.has(item.employeeId)),
      ),
      auditEvents: state.auditEvents.filter(
        (event) => !isDemoAudit(event.objectId, event.summary),
      ),
    },
    changed: true,
    removedEmployees: demoEmployeeIds.size,
  };
}
