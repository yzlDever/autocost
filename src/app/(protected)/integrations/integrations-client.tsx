"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleOff,
  Copy,
  DatabaseZap,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ApiClient, QueryItem, QueryLog } from "@/lib/types";

type SafeApiClient = Omit<ApiClient, "keyHash">;

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });

export function IntegrationsClient({ clients, logs, sampleItems }: { clients: SafeApiClient[]; logs: QueryLog[]; sampleItems: QueryItem[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createdKey, setCreatedKey] = useState("");

  async function createClient() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const result = (await response.json()) as { success: boolean; key?: string; message?: string };
      if (!response.ok || !result.key) throw new Error(result.message ?? "创建失败。");
      setCreatedKey(result.key);
      setName("");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleClient(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const result = (await response.json()) as { success: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? "更新失败。");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "更新失败。");
    } finally {
      setBusy(false);
    }
  }

  const requestExample = `curl -X POST https://<your-domain>/api/v2/labor-cost/query \\
  -H "Authorization: Bearer <security-string>" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ items: sampleItems.length === 2 ? sampleItems : [
    { employeeId: "ding_user_001", periods: [{ period: "2026-07", days: 15 }] },
    { employeeId: "ding_user_002", periods: [{ period: "2026-07", days: 20 }] },
  ] }, null, 2)}'`;

  return (
    <>
      <div className="notice" style={{ marginBottom: 14 }}><ShieldCheck size={17} /><span>接口只返回整批总额，且每次至少需要两名不同人员。人员 ID 使用钉钉 userId。</span></div>
      <section className="split-grid">
        <article className="panel">
          <div className="panel-header"><div><h2 className="panel-title">Security 字符串</h2><p className="panel-subtitle">每个第三方系统独立创建，完整值只展示一次</p></div><KeyRound size={18} style={{ color: "var(--primary)" }} /></div>
          <div className="panel-body">
            <div className="toolbar"><label className="form-field" style={{ flex: 1 }}><span>来源系统名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：经营分析系统" /></label><button className="button button-primary" style={{ alignSelf: "flex-end" }} type="button" disabled={busy || !name.trim()} onClick={createClient}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}创建密钥</button></div>
            {message ? <p className="form-error" role="alert">{message}</p> : null}
            {clients.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>来源</th><th>Security</th><th>状态</th><th>最近调用</th><th /></tr></thead><tbody>{clients.map((client) => <tr key={client.id}><td><span className="table-primary">{client.name}</span></td><td><code>{client.keyPrefix}••••{client.keyLastFour}</code></td><td><span className={`status-pill ${client.status === "active" ? "status-success" : "status-neutral"}`}>{client.status === "active" ? "启用" : "停用"}</span></td><td>{client.lastUsedAt ? dateFormatter.format(new Date(client.lastUsedAt)) : "从未"}</td><td><button className={client.status === "active" ? "button button-danger" : "button button-secondary"} type="button" onClick={() => toggleClient(client.id)} disabled={busy}>{client.status === "active" ? <CircleOff size={14} /> : <CheckCircle2 size={14} />}{client.status === "active" ? "停用" : "启用"}</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><div><DatabaseZap size={28} style={{ marginBottom: 10 }} /><strong>还没有接口来源</strong><span>创建第一枚 Security 字符串以开始测试。</span></div></div>}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h2 className="panel-title">调用示例</h2><p className="panel-subtitle">固定 23 个工作日分摊 · 整批聚合返回</p></div></div>
          <div className="panel-body"><div className="code-block">{requestExample}</div><div className="metric-row" style={{ marginTop: 12 }}><span className="metric-chip">POST</span><span className="metric-chip">Bearer Auth</span><span className="metric-chip">CNY</span><span className="metric-chip">23 Workdays</span></div></div>
        </article>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panel-header"><div><h2 className="panel-title">查询日志</h2><p className="panel-subtitle">成功和失败均保留原因；不保存逐人成本</p></div><span className="metric-chip">最近 {logs.length} 条</span></div>
        {logs.length ? <div className="table-wrap" style={{ maxHeight: 520 }}><table className="data-table"><thead><tr><th>时间</th><th>请求 ID</th><th>来源</th><th>IP</th><th>人数</th><th>状态</th><th>原因</th><th>整批结果</th><th>耗时</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{dateFormatter.format(new Date(log.createdAt))}</td><td><code>{log.requestId.slice(0, 18)}…</code></td><td>{log.clientName}</td><td>{log.sourceIp}</td><td>{log.participantCount}</td><td><span className={`status-pill ${log.success ? "status-success" : "status-error"}`}>{log.success ? "成功" : log.errorCode}</span></td><td title={log.reason}>{log.reason}</td><td>{log.totalCostCents === null ? "—" : currency.format(log.totalCostCents / 100)}</td><td>{log.durationMs}ms</td></tr>)}</tbody></table></div> : <div className="empty-state"><div><strong>暂无查询日志</strong><span>使用上方示例调用接口后，结果会显示在这里。</span></div></div>}
      </section>

      {createdKey ? <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="secret-title"><div className="modal-header"><div><h2 id="secret-title">Security 字符串已创建</h2><p>请立即复制保存。关闭后系统不会再次展示完整值。</p></div><button className="icon-button" type="button" onClick={() => setCreatedKey("")} aria-label="关闭"><X size={18} /></button></div><div className="modal-body"><div className="secret-box">{createdKey}</div><button className="button button-secondary" style={{ marginTop: 12 }} type="button" onClick={() => navigator.clipboard.writeText(createdKey)}><Copy size={15} />复制</button></div><div className="modal-footer"><button className="button button-primary" type="button" onClick={() => setCreatedKey("")}><CheckCircle2 size={16} />我已保存</button></div></section></div> : null}
    </>
  );
}
