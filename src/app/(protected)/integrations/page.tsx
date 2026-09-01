import { PageHeader } from "@/components/page-header";
import { getFinanceState } from "@/lib/dal";
import { IntegrationsClient } from "./integrations-client";

export const metadata = { title: "接口管理" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const state = await getFinanceState();
  const latestPeriod = [...new Set(state.monthlyCosts.map((cost) => cost.period))].sort().at(-1) ?? "2026-07";
  const sampleEmployees = state.employees
    .filter((employee) => state.monthlyCosts.some((cost) => cost.employeeId === employee.id && cost.period === latestPeriod))
    .slice(0, 2);
  return (
    <>
      <PageHeader eyebrow="安全数据服务" title="接口管理" description="为每个第三方系统创建独立 Security 字符串，只提供至少两名有效人员的整批成本总额。" />
      <IntegrationsClient
        clients={state.apiClients.map((client) => ({
          id: client.id,
          name: client.name,
          keyPrefix: client.keyPrefix,
          keyLastFour: client.keyLastFour,
          status: client.status,
          createdAt: client.createdAt,
          lastUsedAt: client.lastUsedAt,
        }))}
        logs={state.queryLogs.slice(0, 100)}
        sampleItems={sampleEmployees.map((employee) => ({
          employeeId: employee.id,
          periods: [{ period: latestPeriod, days: 15 }],
        }))}
      />
    </>
  );
}
