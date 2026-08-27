"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Download, LoaderCircle, RefreshCw, Search, UsersRound } from "lucide-react";
import type { Employee } from "@/lib/types";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

type SyncResult = {
  count: number;
  created: number;
  linked: number;
  updated: number;
  inactivated: number;
  departmentCount: number;
};

export function PeopleClient({
  employees,
  directoryConfigured,
}: {
  employees: Employee[];
  directoryConfigured: boolean;
}) {
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
      const result = (await response.json()) as { success: boolean; result?: SyncResult; message?: string };
      if (!response.ok) throw new Error(result.message ?? "同步失败。");
      const synced = result.result;
      setMessage(
        `钉钉同步完成：${synced?.departmentCount ?? 0} 个部门、${synced?.count ?? 0} 名人员；` +
        `新增 ${synced?.created ?? 0} 名，关联工资人员 ${synced?.linked ?? 0} 名，停用 ${synced?.inactivated ?? 0} 名。`,
      );
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "同步失败。");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className={`notice ${directoryConfigured ? "" : "notice-warning"}`} style={{ marginBottom: 14 }}>
        {directoryConfigured ? <RefreshCw size={17} /> : <CloudOff size={17} />}
        <span>
          <strong>{directoryConfigured ? "钉钉通讯录已配置。" : "钉钉通讯录凭证尚未配置完整。"}</strong>{" "}
          同步会读取应用可见范围内的部门和成员，不读取手机号；首次真实同步会清除演示人员。
        </span>
      </div>
      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、工号、部门或人员 ID" aria-label="搜索人员" /></div>
        <span className="metric-chip"><UsersRound size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{filtered.length} 名人员</span>
        <a className="button button-secondary" style={{ marginLeft: "auto" }} href="/api/payroll/template"><Download size={16} />下载工资模板</a>
        <button className="button button-primary" type="button" onClick={sync} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}同步通讯录</button>
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
