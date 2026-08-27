import { FileSpreadsheet, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getFinanceState } from "@/lib/dal";
import { PayrollClient } from "./payroll-client";

export const metadata = { title: "工资管理" };
export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const state = await getFinanceState();
  const periods = [...new Set(state.monthlyCosts.map((cost) => cost.period))].sort().reverse();
  return (
    <>
      <PageHeader
        eyebrow="工资数据"
        title="工资管理"
        description="按稳定人员 ID 和月份维护公司人力总成本；离职人员仍保留在历史月份中，所有修改都会进入审计记录。"
      />
      <PayrollClient
        employees={state.employees}
        costs={state.monthlyCosts}
        periods={periods}
        imports={state.imports.slice(0, 8)}
      />
      <div style={{ display: "none" }}><FileSpreadsheet /><Upload /></div>
    </>
  );
}
