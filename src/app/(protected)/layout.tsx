import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="app-shell">
      <Sidebar username={session.username} />
      <main className="app-main">{children}</main>
    </div>
  );
}
