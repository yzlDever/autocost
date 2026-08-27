"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json()) as { success: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? "登录失败。");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={onSubmit}>
      <label>
        <span>用户名</span>
        <div className="field-with-icon"><UserRound size={17} /><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></div>
      </label>
      <label>
        <span>密码</span>
        <div className="field-with-icon"><LockKeyhole size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></div>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-primary login-submit" type="submit" disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={18} /> : <>进入系统 <ArrowRight size={18} /></>}
      </button>
    </form>
  );
}
