"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/help", "Overview"],
  ["/help/workflow", "Workflow"],
  ["/help/customers", "Customers"],
  ["/help/vehicles", "Vehicles"],
  ["/help/repair-orders", "Repair Orders"],
  ["/help/invoices", "Invoices"],
  ["/help/receivables", "Receivables"],
  ["/help/reports", "Reports"],
  ["/help/admin", "Admin"],
  ["/help/cutover", "Cutover"],
] as const;

export function HelpNavigation() {
  const pathname = usePathname();
  return <nav aria-label="Help topics" className="mb-6 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">{links.map(([href, label]) => {
    const active = pathname === href;
    return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-brand-primary text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{label}</Link>;
  })}</nav>;
}
