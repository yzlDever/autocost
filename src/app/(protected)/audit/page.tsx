import { BookOpenCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getFinanceState } from "@/lib/dal";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "操作审计" };
export const dynamic = "force-dynamic";

const actionNames: Record<string, string> = {
  "auth.login.success": "登录成功",
  "auth.login.failed": "登录失败",
  "auth.logout": "退出登录",
  "payroll.import": "工资导入",
  "payroll.cost.update": "工资修改",
  "directory.sync": "人员同步",
  "api_client.create": "创建密钥",
  "api_client.status.update": "密钥状态",
};

export default async function AuditPage() {
  const state = await getFinanceState();
  const events = state.auditEvents.slice(0, 500);
  return (
    <>
      <PageHeader eyebrow="安全追溯" title="操作审计" description="登录、导入、工资修改、人员同步和接口密钥操作均可追溯。" />
      <section className="panel">
        <div className="panel-header"><div><h2 className="panel-title">审计事件</h2><p className="panel-subtitle">最近 {events.length} 条 · 不记录密码和明文 Security 字符串</p></div><BookOpenCheck size={18} style={{ color: "var(--primary)" }} /></div>
        {events.length ? <div className="table-wrap" style={{ maxHeight: 680 }}><table className="data-table" aria-label="操作审计日志"><thead><tr><th>时间</th><th>动作</th><th>操作者</th><th>对象</th><th>来源 IP</th><th>说明</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{formatDateTime(event.createdAt)}</td><td><span className={`status-pill ${event.action.endsWith("failed") ? "status-error" : "status-neutral"}`}>{actionNames[event.action] ?? event.action}</span></td><td>{event.actor}</td><td><code>{event.objectType}</code></td><td>{event.sourceIp}</td><td>{event.summary}</td></tr>)}</tbody></table></div> : <div className="empty-state"><div><strong>暂无审计记录</strong><span>完成登录或其他操作后显示。</span></div></div>}
      </section>
    </>
  );
}
