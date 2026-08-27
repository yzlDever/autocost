"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenCheck,
  ChevronRight,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { href: "/payroll", label: "工资管理", icon: WalletCards },
  { href: "/people", label: "人员管理", icon: UsersRound },
  { href: "/integrations", label: "接口管理", icon: Database },
  { href: "/audit", label: "操作审计", icon: BookOpenCheck },
];

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <button className="mobile-menu-button" type="button" onClick={() => setOpen(true)} aria-label="打开导航"><Menu size={20} /></button>
      {open ? <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setOpen(false)} /> : null}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">AC</div>
          <div><strong>Auto Cost</strong><span>人力成本中心</span></div>
          <button className="sidebar-close" type="button" onClick={() => setOpen(false)} aria-label="关闭导航"><X size={19} /></button>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          <span className="nav-section-label">工作台</span>
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={active ? "nav-link nav-link-active" : "nav-link"} onClick={() => setOpen(false)}>
                <Icon size={19} strokeWidth={1.8} /><span>{item.label}</span>{active ? <ChevronRight className="nav-arrow" size={16} /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar">AD</div>
          <div className="user-meta"><strong>{username}</strong><span>财务管理员</span></div>
          <button className="icon-button" type="button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={18} /></button>
        </div>
      </aside>
    </>
  );
}
