"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getBusinessProfile, type ModuleRegistry } from "@/lib/business-profile";

const businessProfile = getBusinessProfile();

const links = [
  { href: "/help", label: "Overview", module: null },
  { href: "/help/workflow", label: "Workflow", module: null },
  { href: "/help/customers", label: "Customers", module: "customers" },
  { href: "/help/vehicles", label: businessProfile.terminology.assetPlural, module: "assets" },
  { href: "/help/repair-orders", label: businessProfile.terminology.workOrderPlural, module: "workOrders" },
  { href: "/help/invoices", label: "Invoices", module: "invoices" },
  { href: "/help/receivables", label: "Receivables", module: "accountsReceivable" },
  { href: "/help/reports", label: "Reports", module: "reports" },
  { href: "/help/admin", label: "Admin", module: "admin" },
  { href: "/help/cutover", label: "Cutover", module: null },
] as const satisfies ReadonlyArray<{ href: string; label: string; module: keyof ModuleRegistry | null }>;

export function HelpNavigation() {
  const pathname = usePathname();
  return <nav aria-label="Help topics" className="mb-6 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">{links.filter((item) => item.module === null || businessProfile.modules[item.module]).map(({ href, label }) => {
    const active = pathname === href;
    return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-brand-primary text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{label}</Link>;
  })}</nav>;
}
