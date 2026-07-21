"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin/app-settings", label: "App Settings" },
  { href: "/admin/shop-settings", label: "Shop Settings" },
  { href: "/admin/services", label: "Services" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/audit-log", label: "Audit Log" },
  { href: "/admin/data-tools", label: "Data Tools" },
] as const;

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin navigation" className="mb-6 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link 
            key={link.href} 
            href={link.href} 
            aria-current={active ? "page" : undefined} 
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active 
                ? "bg-brand-primary text-white" 
                : "text-slate-600 hover:bg-brand-subtle hover:text-brand-primary"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}