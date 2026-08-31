"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  PencilLine,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { Employee, ImportError, ImportRow, MonthlyCost, PayrollImport } from "@/lib/types";

type Preview = {
  fileName: string;
  sheetName: string;
  format: "system_template" | "legacy";
  period: string | null;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: ImportRow[];
  errors: ImportError[];
};

const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });

export function PayrollClient({
  employees,
  costs,
  periods,
  imports,
}: {
  employees: Employee[];
  costs: MonthlyCost[];
  periods: string[];
  imports: PayrollImport[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("全部部门");
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [edit, setEdit] = useState<{ employee: Employee; period: string; amountCents: number } | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");

  const costMap = useMemo(
    () => new Map(costs.map((cost) => [`${cost.employeeId}:${cost.period}`, cost])),
    [costs],
  );
  const departments = useMemo(
    () => ["全部部门", ...new Set(employees.map((employee) => employee.department))],
    [employees],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return employees.filter((employee) => {
      const matchesDepartment = department === "全部部门" || employee.department === department;
      const matchesQuery = !normalized || `${employee.name} ${employee.employeeNo ?? ""} ${employee.department}`.toLowerCase().includes(normalized);
      return matchesDepartment && matchesQuery;
    });
  }, [department, employees, query]);

  async function runImport(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const data = new FormData();
      data.set("file", file);
      const response = await fetch(`/api/payroll/import?mode=${mode}`, { method: "POST", body: data });
      const result = (await response.json()) as { success: boolean; message?: string; preview?: Preview };
      if (!response.ok) throw new Error(result.message ?? "导入失败。");
      if (mode === "preview" && result.preview) {
        setPreview(result.preview);
      } else {
        setMessage("工资数据已安全导入，原始文件未被保存。");
        setPreview(null);
        setFile(null);
        router.refresh();
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "导入失败。");
    } finally {
      setBusy(false);
    }
  }

  function openEdit(employee: Employee, period: string, amountCents: number) {
    setEdit({ employee, period, amountCents });
    setEditAmount((amountCents / 100).toFixed(2));
    setEditReason("");
    setMessage("");
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/payroll/cost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: edit.employee.id,
          period: edit.period,
          amount: Number(editAmount),
          reason: editReason,
        }),
      });
      const result = (await response.json()) as { success: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? "修改失败。");
      setEdit(null);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "修改失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、工号或部门" aria-label="搜索工资人员" /></div>
        <label className="form-field" style={{ minWidth: 160 }}><select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="筛选部门">{departments.map((item) => <option key={item}>{item}</option>)}</select></label>
        <span className="metric-chip">{filtered.length} 名人员</span>
        <button className="button button-primary" style={{ marginLeft: "auto" }} type="button" onClick={() => { setImportOpen(true); setMessage(""); }}><Upload size={16} />导入 Excel</button>
      </div>

      <section className="panel">
        <div className="table-wrap" style={{ maxHeight: 590 }}>
          <table className="data-table" aria-label="月度人力成本表">
            <thead><tr><th className="sticky-col-1">部门</th><th className="sticky-col-2">姓名</th>{periods.map((period) => <th key={period}>{period}</th>)}</tr></thead>
            <tbody>
              {filtered.map((employee) => (
                <tr key={employee.id}>
                  <td className="sticky-col-1"><span className="table-primary">{employee.department}</span></td>
                  <td className="sticky-col-2"><span className="table-primary">{employee.name}</span><span className="table-secondary">{employee.employeeNo ?? employee.id} · {employee.status === "active" ? "在职" : "离职"}</span></td>
                  {periods.map((period) => {
                    const cost = costMap.get(`${employee.id}:${period}`);
                    return <td key={period}>{cost ? <button className="money-cell" type="button" onClick={() => openEdit(employee, period, cost.amountCents)} title="点击修改"><PencilLine size={11} style={{ marginRight: 5, verticalAlign: -2 }} />{currency.format(cost.amountCents / 100)}</button> : <span className="empty-cell">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panel-header"><div><h2 className="panel-title">最近导入</h2><p className="panel-subtitle">只保存摘要，不保留包含身份证和银行卡信息的原始文件</p></div></div>
        {imports.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>文件</th><th>有效记录</th><th>操作人</th><th>状态</th></tr></thead><tbody>{imports.map((item) => <tr key={item.id}><td>{item.period}</td><td>{item.fileName}</td><td>{item.validRows}</td><td>{item.actor}</td><td><span className="status-pill status-success"><CheckCircle2 size={11} />已导入</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><div><strong>暂无导入记录</strong><span>导入第一份工资 Excel 后在这里查看。</span></div></div>}
      </section>

      {importOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <div className="modal-header"><div><h2 id="import-title">导入月度工资</h2><p>系统模板按钉钉人员编码精确匹配，并保留每个月的人员和部门快照。</p></div><button className="icon-button" type="button" onClick={() => setImportOpen(false)} aria-label="关闭"><X size={18} /></button></div>
            <div className="modal-body">
              <div className="notice" style={{ marginBottom: 14 }}><Download size={17} /><span>请优先使用人员管理页面生成的最新模板。<a href="/api/payroll/template" style={{ marginLeft: 5, fontWeight: 760 }}>下载系统工资模板</a></span></div>
              <label className="file-drop"><div><FileSpreadsheet size={28} style={{ color: "var(--primary)" }} /><strong style={{ display: "block", marginTop: 9, color: "var(--text)" }}>选择工资 Excel</strong><span style={{ fontSize: 11 }}>仅支持 .xlsx，最大 10 MB</span><input type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setMessage(""); }} /></div></label>
              {preview ? <><div className="preview-stats"><div className="preview-stat"><span>工资期间</span><strong>{preview.period ?? "异常"}</strong></div><div className="preview-stat"><span>有效记录</span><strong>{preview.validRows}</strong></div><div className="preview-stat"><span>错误记录</span><strong style={{ color: preview.errorRows ? "var(--danger)" : "var(--success)" }}>{preview.errorRows}</strong></div></div><div className={preview.errorRows ? "notice notice-warning" : "notice"}>{preview.errorRows ? `发现 ${preview.errorRows} 个问题，修正前不能提交。` : `校验通过：${preview.format === "system_template" ? "钉钉人员编码已全部匹配" : "旧版表格已按唯一工号/姓名匹配"}，可安全导入 ${preview.validRows} 条记录。`}</div>{preview.errors.length ? <ul style={{ color: "var(--danger)", fontSize: 11, lineHeight: 1.8 }}>{preview.errors.slice(0, 8).map((item) => <li key={`${item.sourceRow}-${item.name}`}>第 {item.sourceRow || "-"} 行 · {item.name}：{item.message}</li>)}</ul> : null}</> : null}
              {message ? <p className={message.includes("已安全") ? "notice" : "form-error"} role="status">{message}</p> : null}
            </div>
            <div className="modal-footer"><button className="button button-secondary" type="button" onClick={() => setImportOpen(false)}>取消</button>{preview ? <button className="button button-primary" type="button" disabled={busy || preview.errorRows > 0} onClick={() => runImport("commit")}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}确认导入</button> : <button className="button button-primary" type="button" disabled={busy || !file} onClick={() => runImport("preview")}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}校验并预览</button>}</div>
          </section>
        </div>
      ) : null}

      {edit ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
            <div className="modal-header"><div><h2 id="edit-title">修改月度成本</h2><p>{edit.employee.name} · {edit.period}</p></div><button className="icon-button" type="button" onClick={() => setEdit(null)} aria-label="关闭"><X size={18} /></button></div>
            <div className="modal-body form-grid">
              <label className="form-field"><span>公司人力总成本（元）</span><input type="number" min="0" step="0.01" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} /></label>
              <label className="form-field"><span>修改原因（必填）</span><textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} placeholder="例如：财务复核后调整单位社保金额" /></label>
              {message ? <p className="form-error" role="alert">{message}</p> : null}
            </div>
            <div className="modal-footer"><button className="button button-secondary" type="button" onClick={() => setEdit(null)}>取消</button><button className="button button-primary" type="button" onClick={saveEdit} disabled={busy || !editReason.trim() || !editAmount}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}保存修改</button></div>
          </section>
        </div>
      ) : null}
    </>
  );
}
