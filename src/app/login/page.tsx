import { redirect } from "next/navigation";
import { ScanLine, ShieldCheck, Sparkles } from "lucide-react";
import { isDingTalkAuthConfigured } from "@/lib/dingtalk";
import { getSession } from "@/lib/session";

export const metadata = { title: "登录" };

const loginErrors: Record<string, string> = {
  dingtalk_not_configured: "钉钉登录尚未完成应用配置，请联系系统管理员。",
  dingtalk_state_invalid: "登录请求已过期，请重新扫码。",
  dingtalk_cancelled: "钉钉授权已取消。",
  dingtalk_rejected: "钉钉未能确认本次登录，请重新扫码。",
  dingtalk_wrong_org: "请选择公司企业组织后再登录。",
  dingtalk_not_member: "当前账号不是公司企业组织的有效成员。",
  dingtalk_not_allowed: "当前账号不在系统登录范围中。",
  dingtalk_unavailable: "钉钉身份服务暂时不可用，请稍后重试。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;
  const errorMessage = error ? loginErrors[error] : null;
  const dingTalkConfigured = isDingTalkAuthConfigured();
  return (
    <main className="login-page">
      <section className="login-intro" aria-label="系统介绍">
        <div className="brand-mark brand-mark-light">AC</div>
        <div className="login-intro-copy">
          <span className="login-kicker"><Sparkles size={14} /> HEILS FINANCE</span>
          <h1>让敏感数据<br />留在正确的边界内</h1>
          <p>独立管理工资数据，以受控的聚合结果服务经营分析。</p>
        </div>
        <div className="security-note"><ShieldCheck size={18} /><span>仅限授权财务人员访问</span></div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand"><div className="brand-mark">AC</div><strong>Auto Cost</strong></div>
          <span className="eyebrow">企业安全登录</span>
          <h2>欢迎回来</h2>
          <p className="muted">登录后查看、维护和安全地提供人力成本数据。</p>
          {errorMessage ? <p className="form-error login-provider-error" role="alert">{errorMessage}</p> : null}
          {dingTalkConfigured ? (
            <a className="button dingtalk-login" href="/api/auth/dingtalk">
              <ScanLine size={18} /> 使用钉钉扫码登录
            </a>
          ) : (
            <button className="button dingtalk-login" type="button" disabled title="完成钉钉应用配置后启用">
              <ScanLine size={18} /> 钉钉扫码登录待配置
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
