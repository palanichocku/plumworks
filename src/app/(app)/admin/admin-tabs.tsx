"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { name: "App Settings", href: "/admin/app-settings" },
  { name: "Shop Settings", href: "/admin/shop-settings" },
  { name: "Services", href: "/admin/services" },
  { name: "Leads", href: "/admin/leads" },
  { name: "Staff", href: "/admin/staff" },
  { name: "Audit Log", href: "/admin/audit-log" },
  { name: "Data Tools", href: "/admin/data-tools" },
];

export function AdminTabs() {
  const pathname = usePathname();

  return (
    <div className="border-b border-slate-200 mb-6">
      <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={`
                whitespace-nowrap border-b-2 py-4 px-1 text-sm font-bold transition-colors
                ${isActive
                  ? "border-brand-primary text-brand-primary"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }
              `}
            >
              {tab.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}