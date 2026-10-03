import Link from "next/link";
import { DashboardNavTabs } from "@/components/DashboardNavTabs";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2.5 font-semibold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
              AI
            </span>
            Thi Trực tuyến AI
          </Link>
          <form action="/api/auth/logout" method="POST">
            <button className="text-sm font-medium text-slate-500 transition hover:text-slate-800">Đăng xuất</button>
          </form>
        </div>
      </header>
      <DashboardNavTabs />
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
