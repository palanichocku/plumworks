import React from "react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { getDashboardSummary } from "@/lib/data/dashboard";
import { getCurrentMembership } from "@/lib/data/membership";
import { formatDate, formatMoney } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [{ membership }, summary] = await Promise.all([
    getCurrentMembership(),
    getDashboardSummary(),
  ]);
  const shop = membership?.shop;

  if (!shop || !summary) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <PageHeading eyebrow="Overview" title="Dashboard" description="Your connected shop workspace." />
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">No shop membership found</h2>
        </section>
      </div>
    );
  }

  const cards = [
    { label: "Open Repair Orders", value: String(summary.openRepairOrders), supporting: "Draft and open", href: "/repair-orders" },
    { label: "Customers", value: String(summary.customers), supporting: "Customer records", href: "/customers" },
    { label: "Vehicles", value: String(summary.vehicles), supporting: "Registered vehicles", href: "/vehicles" },
    {
  label: "Invoices This Month",
  value: summary.monthlyInvoiceCount.toLocaleString(),
  supporting: `${formatMoney(summary.monthlyInvoiceTotal)} billed`,
  href: "/invoices",
},
    { label: "New Leads", value: summary.newLeadCount === null ? "—" : String(summary.newLeadCount), supporting: summary.newLeadCount === null ? "Admin access required" : "Awaiting review", href: summary.newLeadCount === null ? null : "/admin/leads?status=NEW" },
  ] as const;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Dynamic Header Frame */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeading eyebrow="Overview" title="Dashboard" description="Current shop activity and customer workflow at a glance." />
        <div className="shrink-0 md:text-right">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold tracking-wide text-emerald-700 border border-emerald-200 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Sync Connected
          </span>
        </div>
      </div>

      {/* --- METRIC CARD GRID ARCHITECTURE --- */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => {
          const content = <>
            <div className="absolute bottom-0 left-0 top-0 w-1.5 bg-brand-primary opacity-0 transition-opacity group-hover:opacity-100" />
            <p className="text-xs font-extrabold uppercase tracking-widest text-slate-500 transition-colors group-hover:text-brand-primary">{card.label}</p>
            <p className="mt-4 text-3xl font-black tracking-tight text-slate-900">{card.value}</p>
            <p className="mt-2 text-xs font-semibold text-slate-500">{card.supporting}</p>
          </>;
          const className = "group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200";
          return card.href ? <Link key={card.label} href={card.href} className={`${className} hover:-translate-y-1 hover:border-brand-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20`}>{content}</Link> : <article key={card.label} className={`${className} opacity-75`}>{content}</article>;
        })}
      </section>

      {/* --- MAIN OPERATIONAL ACTIVITY LAYOUT --- */}
      <section className="grid gap-6 xl:grid-cols-2">
        <ActivityCard title="Invoices in Progress" href="/invoices" emptyMessage="No invoices are currently in progress.">
          {summary.inProgressInvoices.map((invoice) => {
            const balance = invoice.accountsReceivable[0]?.balance;
            const workflowLabel = !balance ? "Balance unavailable" : balance.greaterThan(0) ? "Awaiting payment" : balance.isZero() ? "Ready to close" : "Balance review";
            const readyToClose = workflowLabel === "Ready to close";
            return <li key={invoice.id} className="group border-l-2 border-transparent transition-colors hover:border-brand-primary hover:bg-slate-50/70">
              <Link href={`/invoices/${invoice.id}`} className="block px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-900 transition-colors group-hover:text-brand-primary">RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "N/A"}</span>
                  <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-2xs ${readyToClose ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{workflowLabel}</span>
                </div>
                <div className="mt-1.5 flex justify-between gap-3 text-xs font-medium text-slate-500"><span className="max-w-[150px] truncate font-semibold text-slate-700">{invoice.customer.displayName}</span><span>{formatDate(invoice.invoiceDate)}</span></div>
                <div className="mt-2 flex justify-between gap-3 text-xs font-semibold text-slate-600"><span>Total {formatMoney(invoice.total)}</span><span>Balance {balance ? formatMoney(balance) : "Unavailable"}</span></div>
              </Link>
            </li>;
          })}
        </ActivityCard>

        <ActivityCard title="Closed Invoices" href="/invoices" emptyMessage="No closed invoices are available.">
          {summary.closedInvoices.map((invoice) => (
            <li key={invoice.id} className="group border-l-2 border-transparent transition-colors hover:border-brand-primary hover:bg-slate-50/70">
              <Link href={`/invoices/${invoice.id}`} className="block px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-900 transition-colors group-hover:text-brand-primary">RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "N/A"}</span>
                  <span className="text-sm font-black text-emerald-600">{formatMoney(invoice.total)}</span>
                </div>
                <div className="mt-1.5 flex justify-between gap-3 text-xs font-medium text-slate-500"><span className="max-w-[150px] truncate font-semibold text-slate-700">{invoice.customer.displayName}</span><span>Closed {formatDate(invoice.closedAt)}</span></div>
              </Link>
            </li>
          ))}
        </ActivityCard>

      </section>
    </div>
  );
}

// Upgraded inner component to match the table headers
function ActivityCard({ title, href, emptyMessage, children }: { title: string; href: string; emptyMessage: string; children: React.ReactNode }) {
  // Safely extract valid children to ensure empty states render correctly
  const items = React.Children.toArray(children).filter(Boolean);
  
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Header mimics the new table header rows (border-b-2, bg-slate-100/80) */}
      <header className="flex items-center justify-between border-b-2 border-slate-200 bg-slate-100/80 px-5 py-4">
        <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-700">{title}</h2>
        <Link 
          href={href} 
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 shadow-xs transition-all hover:border-brand-primary/30 hover:text-brand-primary"
        >
          View all
        </Link>
      </header>
      
      {items.length ? (
        <ul className="flex-1 divide-y divide-slate-100">{items}</ul>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-center text-sm font-medium text-slate-400 italic">
            {emptyMessage}
          </p>
        </div>
      )}
    </article>
  );
}
