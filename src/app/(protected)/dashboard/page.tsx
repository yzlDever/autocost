import {
  ArrowUpRight,
  BadgeDollarSign,
  CalendarDays,
  CircleDollarSign,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getFinanceState } from "@/lib/dal";
import { formatCurrency } from "@/lib/utils";

export const metadata = { title: "仪表盘" };
export const dynamic = "force-dynamic";

function sumPeriod(state: Awaited<ReturnType<typeof getFinanceState>>, periods: Set<string>) {
  return state.monthlyCosts
    .filter((cost) => periods.has(cost.period))
    .reduce((sum, cost) => sum + cost.amountCents, 0);
}

export default async function DashboardPage() {
  const state = await getFinanceState();
  const periods = [...new Set(state.monthlyCosts.map((cost) => cost.period))].sort();
  const latestPeriod = periods.at(-1) ?? null;
  const latestTotal = latestPeriod ? sumPeriod(state, new Set([latestPeriod])) : 0;
  const [latestYear, latestMonth] = latestPeriod?.split("-").map(Number) ?? [0, 0];
  const quarter = latestMonth ? Math.ceil(latestMonth / 3) : 0;
  const quarterPeriods = new Set(
    periods.filter((period) => {
      const [year, month] = period.split("-").map(Number);
      return year === latestYear && Math.ceil(month / 3) === quarter;
    }),
  );
  const yearPeriods = new Set(periods.filter((period) => period.startsWith(`${latestYear}-`)));
  const quarterTotal = sumPeriod(state, quarterPeriods);
  const yearTotal = sumPeriod(state, yearPeriods);
  const activeCount = state.employees.filter((employee) => employee.status === "active").length;
  const averageCost = activeCount ? Math.round(latestTotal / activeCount) : 0;
  const trend = periods.slice(-12).map((period) => ({
    period,
    amount: sumPeriod(state, new Set([period])),
  }));
  const maxTrend = Math.max(...trend.map((item) => item.amount), 1);
  const departmentMap = new Map<string, number>();
  if (latestPeriod) {
    state.monthlyCosts
      .filter((cost) => cost.period === latestPeriod)
      .forEach((cost) => departmentMap.set(
        cost.departmentSnapshot,
        (departmentMap.get(cost.departmentSnapshot) ?? 0) + cost.amountCents,
      ));
  }
  const departments = [...departmentMap.entries()].sort((a, b) => b[1] - a[1]);

  const cards = [
    { label: "最新月份", value: formatCurrency(latestTotal), meta: latestPeriod ?? "暂无数据", icon: WalletCards },
    { label: "本季度累计", value: formatCurrency(quarterTotal), meta: latestPeriod ? `${latestYear} Q${quarter}` : "暂无数据", icon: CalendarDays },
    { label: "本年度累计", value: formatCurrency(yearTotal), meta: latestYear ? `${latestYear} 年` : "暂无数据", icon: CircleDollarSign },
    { label: "在职人数", value: `${activeCount} 人`, meta: "当前人员目录", icon: UsersRound },
    { label: "人均月成本", value: formatCurrency(averageCost), meta: latestPeriod ?? "暂无数据", icon: BadgeDollarSign },
  ];

  return (
    <>
      <PageHeader eyebrow="经营分析" title="人力成本仪表盘" description="从月度工资数据出发，快速查看本月、本季度和年度的人力成本变化。" />
      <div className="notice" style={{ marginBottom: 14 }}>
        <ArrowUpRight size={17} />
        <span>{state.imports.length
          ? `当前展示已导入的 ${latestPeriod ?? "最新"} 工资数据；所有金额仅对财务登录态开放。`
          : "当前为环境测试版本，展示脱敏演示数据；导入工资表后将自动替换演示人员和成本。"}</span>
      </div>
      <section className="kpi-grid" aria-label="核心指标">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article className="panel kpi-card" key={card.label}>
              <div className="kpi-icon"><Icon size={17} /></div>
              <span className="kpi-label">{card.label}</span>
              <strong className="kpi-value">{card.value}</strong>
              <span className="kpi-meta">{card.meta}</span>
            </article>
          );
        })}
      </section>
      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2 className="panel-title">近 12 个月成本趋势</h2><p className="panel-subtitle">月度公司人力总成本 · CNY</p></div></div>
          <div className="panel-body">
            {trend.length ? (
              <div className="trend-chart" aria-label="月度人力成本柱状图">
                {trend.map((item) => (
                  <div className="trend-item" key={item.period} title={`${item.period} ${formatCurrency(item.amount)}`}>
                    <div className="trend-bar-wrap"><div className="trend-bar" style={{ height: `${Math.max(5, (item.amount / maxTrend) * 100)}%` }} /></div>
                    <span className="trend-label">{item.period.slice(2)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="empty-state"><div><strong>暂无工资数据</strong><span>请前往工资管理导入 Excel。</span></div></div>}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h2 className="panel-title">部门成本分布</h2><p className="panel-subtitle">{latestPeriod ?? "暂无月份"} · 合计与最新月一致</p></div></div>
          <div className="panel-body department-list">
            {departments.length ? departments.slice(0, 8).map(([department, amount]) => (
              <div className="department-row" key={department}>
                <div className="department-row-top"><span>{department}</span><span>{formatCurrency(amount)}</span></div>
                <div className="progress"><span style={{ width: `${latestTotal ? (amount / latestTotal) * 100 : 0}%` }} /></div>
              </div>
            )) : <div className="empty-state"><div><strong>暂无部门数据</strong><span>完成一次工资导入后显示。</span></div></div>}
          </div>
        </article>
      </section>
    </>
  );
}
