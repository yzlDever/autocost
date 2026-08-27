export type EmployeeStatus = "active" | "inactive";
export type EmployeeSource = "dingtalk" | "excel" | "demo";

export type Employee = {
  id: string;
  dingtalkUserId: string | null;
  employeeNo: string | null;
  name: string;
  department: string;
  status: EmployeeStatus;
  source: EmployeeSource;
  lastSyncedAt: string;
};

export type MonthlyCost = {
  employeeId: string;
  employeeNameSnapshot: string;
  departmentSnapshot: string;
  period: string;
  amountCents: number;
  version: number;
  updatedBy: string;
  updatedAt: string;
};

export type PayrollImport = {
  id: string;
  fileName: string;
  sha256: string;
  period: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  status: "committed" | "failed";
  actor: string;
  createdAt: string;
};

export type ApiClient = {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  keyLastFour: string;
  status: "active" | "inactive";
  createdAt: string;
  lastUsedAt: string | null;
};

export type QueryItem = {
  employeeId: string;
  from: string;
  to: string;
};

export type QueryLog = {
  id: string;
  requestId: string;
  clientId: string | null;
  clientName: string;
  sourceIp: string;
  userAgent: string;
  participantCount: number;
  totalDays: number;
  fingerprint: string;
  queryItems: QueryItem[];
  success: boolean;
  errorCode: string | null;
  reason: string;
  totalCostCents: number | null;
  durationMs: number;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  summary: string;
  sourceIp: string;
  createdAt: string;
};

export type StoreState = {
  schemaVersion: 1;
  employees: Employee[];
  monthlyCosts: MonthlyCost[];
  imports: PayrollImport[];
  apiClients: ApiClient[];
  queryLogs: QueryLog[];
  auditEvents: AuditEvent[];
};

export type ImportRow = {
  sourceRow: number;
  employeeId: string | null;
  employeeNo: string | null;
  name: string;
  department: string;
  period: string;
  amountCents: number;
};

export type ImportError = {
  sourceRow: number;
  name: string;
  message: string;
};

export type ImportPreview = {
  fileName: string;
  sha256: string;
  sheetName: string;
  format: "system_template" | "legacy";
  period: string | null;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: ImportRow[];
  errors: ImportError[];
};
