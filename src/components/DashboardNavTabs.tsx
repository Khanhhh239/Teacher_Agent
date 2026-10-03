"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Kho đề thi" },
  { href: "/dashboard/rooms", label: "Kho phòng thi" },
];

export function DashboardNavTabs() {
  const pathname = usePathname();

  return (
    <nav className="border-b bg-white px-4">
      <div className="mx-auto flex w-full max-w-5xl gap-1">
        {TABS.map((tab) => {
          const active = tab.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
