import { redirect } from "next/navigation";
import { ShieldCheck, Sparkles } from "lucide-react";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
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
          <span className="eyebrow">环境测试</span>
          <h2>欢迎回来</h2>
          <p className="muted">登录后查看、维护和安全地提供人力成本数据。</p>
          <LoginForm />
          <div className="test-account"><span>测试账号</span><code>admin</code><span>/</span><code>admin123</code></div>
        </div>
      </section>
    </main>
  );
}
