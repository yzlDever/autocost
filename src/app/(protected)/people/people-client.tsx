"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, LoaderCircle, RefreshCw, Search, UsersRound } from "lucide-react";
import type { Employee } from "@/lib/types";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

export function PeopleClient({ employees }: { employees: Employee[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return employees.filter((employee) => !value || `${employee.name} ${employee.employeeNo ?? ""} ${employee.department} ${employee.id}`.toLowerCase().includes(value));
  }, [employees, query]);

  async function sync() {
    setSyncing(true);
    setMessage("");
    try {
      const response = await fetch("/api/people/sync", { method: "POST" });
      const result = (await response.json()) as { success: boolean; result?: { count: number }; message?: string };
      if (!response.ok) throw new Error(result.message ?? "同步失败。");
      setMessage(`演示同步完成，共更新 ${result.result?.count ?? 0} 名人员。`);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "同步失败。");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="notice notice-warning" style={{ marginBottom: 14 }}><CloudOff size={17} /><span><strong>钉钉真实同步尚未配置。</strong> 当前按钮执行演示同步并验证审计链路；提供企业内部应用凭据后可切换为真实通讯录。</span></div>
      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、工号、部门或人员 ID" aria-label="搜索人员" /></div>
        <span className="metric-chip"><UsersRound size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{filtered.length} 名人员</span>
        <button className="button button-primary" style={{ marginLeft: "auto" }} type="button" onClick={sync} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}同步通讯录</button>
      </div>
      {message ? <p className="notice" role="status" style={{ marginBottom: 14 }}>{message}</p> : null}
      <section className="panel">
        <div className="table-wrap" style={{ maxHeight: 650 }}>
          <table className="data-table" aria-label="公司人员目录">
            <thead><tr><th>姓名</th><th>人员 ID</th><th>工号</th><th>部门</th><th>状态</th><th>来源</th><th>最后同步</th></tr></thead>
            <tbody>{filtered.map((employee) => <tr key={employee.id}><td><span className="table-primary">{employee.name}</span></td><td><code>{employee.id}</code></td><td>{employee.employeeNo ?? "—"}</td><td>{employee.department}</td><td><span className={`status-pill ${employee.status === "active" ? "status-success" : "status-neutral"}`}>{employee.status === "active" ? "在职" : "离职"}</span></td><td><span className="status-pill status-neutral">{employee.source === "demo" ? "演示" : employee.source === "excel" ? "Excel" : "钉钉"}</span></td><td>{dateFormatter.format(new Date(employee.lastSyncedAt))}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
