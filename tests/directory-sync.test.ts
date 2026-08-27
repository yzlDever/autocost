import assert from "node:assert/strict";
import test from "node:test";
import { applyDingTalkDirectorySnapshot } from "../src/lib/directory-sync";
import type { StoreState } from "../src/lib/types";

function emptyState(): StoreState {
  return {
    schemaVersion: 1,
    employees: [],
    monthlyCosts: [],
    imports: [],
    apiClients: [],
    queryLogs: [],
    auditEvents: [],
  };
}

const now = "2026-08-26T12:00:00.000Z";

test("creates DingTalk employees and resolves department names", () => {
  const state = emptyState();
  const result = applyDingTalkDirectorySnapshot(state, {
    departments: new Map([[1, "全公司"], [20, "财务部"]]),
    people: [{ userId: "ding-1", name: "张三", employeeNo: "F001", departmentIds: [1, 20] }],
  }, now);

  assert.equal(result.created, 1);
  assert.equal(state.employees[0]?.dingtalkUserId, "ding-1");
  assert.equal(state.employees[0]?.department, "财务部");
  assert.equal(state.employees[0]?.source, "dingtalk");
});

test("links an imported payroll employee by employee number without changing its stable id", () => {
  const state = emptyState();
  state.employees.push({
    id: "emp-existing",
    dingtalkUserId: null,
    employeeNo: "F001",
    name: "张三（工资表）",
    department: "旧部门",
    status: "active",
    source: "excel",
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
  });

  const result = applyDingTalkDirectorySnapshot(state, {
    departments: new Map([[1, "全公司"], [20, "财务部"]]),
    people: [{ userId: "ding-1", name: "张三", employeeNo: "F001", departmentIds: [20] }],
  }, now);

  assert.equal(result.linked, 1);
  assert.equal(state.employees[0]?.id, "emp-existing");
  assert.equal(state.employees[0]?.dingtalkUserId, "ding-1");
  assert.equal(state.employees[0]?.name, "张三");
});

test("marks missing DingTalk members inactive and keeps payroll history", () => {
  const state = emptyState();
  state.employees.push({
    id: "emp-existing",
    dingtalkUserId: "ding-old",
    employeeNo: "F002",
    name: "李四",
    department: "财务部",
    status: "active",
    source: "dingtalk",
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
  });
  state.monthlyCosts.push({
    employeeId: "emp-existing",
    employeeNameSnapshot: "李四",
    departmentSnapshot: "财务部",
    period: "2026-07",
    amountCents: 100_000,
    version: 1,
    updatedBy: "admin",
    updatedAt: "2026-07-31T00:00:00.000Z",
  });

  const result = applyDingTalkDirectorySnapshot(state, {
    departments: new Map([[1, "全公司"]]),
    people: [],
  }, now);

  assert.equal(result.inactivated, 1);
  assert.equal(state.employees[0]?.status, "inactive");
  assert.equal(state.monthlyCosts.length, 1);
});
