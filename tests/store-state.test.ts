import assert from "node:assert/strict";
import test from "node:test";
import { purgeLegacyTestData } from "../src/lib/store-state";
import type { StoreState } from "../src/lib/types";

test("purges legacy demo data without deleting real people or payroll history", () => {
  const state = {
    schemaVersion: 1,
    employees: [
      {
        id: "emp_demo_01",
        dingtalkUserId: "ding_demo_01",
        employeeNo: "D0001",
        name: "legacy-demo-person",
        department: "财务部",
        status: "active",
        source: "demo",
        lastSyncedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "emp-real-inactive",
        dingtalkUserId: "ding-real",
        employeeNo: "F001",
        name: "历史人员",
        department: "财务部",
        status: "inactive",
        source: "dingtalk",
        lastSyncedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    monthlyCosts: [
      {
        employeeId: "emp_demo_01",
        employeeNameSnapshot: "legacy-demo-person",
        departmentSnapshot: "财务部",
        period: "2026-07",
        amountCents: 100_000,
        version: 1,
        updatedBy: "system",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        employeeId: "emp-real-inactive",
        employeeNameSnapshot: "历史人员",
        departmentSnapshot: "财务部",
        period: "2026-07",
        amountCents: 200_000,
        version: 1,
        updatedBy: "finance",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    ],
    imports: [],
    apiClients: [],
    queryLogs: [],
    auditEvents: [{
      id: "audit-demo",
      actor: "system",
      action: "directory.sync",
      objectType: "employee_directory",
      objectId: "demo",
      summary: "legacy demo sync",
      sourceIp: "127.0.0.1",
      createdAt: "2026-07-01T00:00:00.000Z",
    }],
  } as unknown as StoreState;

  const result = purgeLegacyTestData(state);

  assert.equal(result.changed, true);
  assert.equal(result.removedEmployees, 1);
  assert.deepEqual(result.state.employees.map((employee) => employee.id), ["emp-real-inactive"]);
  assert.deepEqual(result.state.monthlyCosts.map((cost) => cost.employeeId), ["emp-real-inactive"]);
  assert.equal(result.state.auditEvents.length, 0);
});
