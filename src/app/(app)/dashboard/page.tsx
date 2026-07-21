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
    ["Open repair orders", summary.openRepairOrders, "/repair-orders"],
    ["Web draft/open orders", summary.webRepairOrders, "/repair-orders"],
    ["Open receivables", summary.openReceivables, "/accounts-receivable"],
    ["Open AR balance", formatMoney(summary.openReceivableBalance), "/accounts-receivable"],
    ["Customers", summary.customers, "/customers"],
    ["Vehicles", summary.vehicles, "/vehicles"],
    ["Invoices, last 30 days", summary.recentInvoiceCount, "/invoices"],
    ...(summary.newLeadCount === null ? [] : [["New leads", summary.newLeadCount, "/admin/leads"]] as const),
  ] as const;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Dynamic Header Frame */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeading eyebrow="Overview" title="Dashboard" description="Current shop activity, active drafts, and receivables ledger balances." />
        <div className="shrink-0 md:text-right">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold tracking-wide text-emerald-700 border border-emerald-200 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Sync Connected
          </span>
        </div>
      </div>

      {/* --- METRIC CARD GRID ARCHITECTURE --- */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value, href]) => (
          <Link 
            key={label} 
            href={href} 
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-primary/40 hover:shadow-lg"
          >
            {/* Thickened the hover accent to match overall heavier UI */}
            <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-brand-primary opacity-0 transition-opacity group-hover:opacity-100" />
            {/* Boosted label contrast from text-slate-400 to text-slate-500 font-extrabold */}
            <p className="text-xs font-extrabold uppercase tracking-widest text-slate-500 group-hover:text-brand-primary transition-colors">
              {label}
            </p>
            <p className="mt-4 text-3xl font-black text-slate-900 tracking-tight">
              {value}
            </p>
          </Link>
        ))}
      </section>

      {/* --- MAIN OPERATIONAL ACTIVITY LAYOUT --- */}
      <section className="grid gap-6 xl:grid-cols-3">
        {/* RECENT REPAIR ORDERS */}
        <ActivityCard title="Recent Repair Orders" href="/repair-orders">
          {summary.recentRepairOrders.map((order) => {
            const isDraft = order.status.toLowerCase() === "draft";
            return (
              <li key={order.id} className="group transition-colors hover:bg-slate-50/70 border-l-2 border-transparent hover:border-brand-primary">
                <Link 
                  href={order.legacySourceTable ? `/open-orders/${order.id}` : `/repair-orders/${order.id}`} 
                  className="block px-5 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-slate-900 group-hover:text-brand-primary transition-colors">
                      RO #{order.repairOrderNumber ?? order.legacyRoNo ?? "Draft"}
                    </span>
                    <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border shadow-2xs ${
                      isDraft 
                        ? "bg-amber-50 text-amber-700 border-amber-200" 
                        : "bg-brand-subtle text-brand-primary border-brand-primary/30"
                    }`}>
                      {order.status}
                    </span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs text-slate-500 font-medium">
                    <span className="truncate max-w-[150px] font-semibold text-slate-700">{order.customer.displayName}</span>
                    <span>{formatDate(order.openedAt)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ActivityCard>

        {/* RECENT INVOICES */}
        <ActivityCard title="Recent Closed Invoices" href="/invoices">
          {summary.recentInvoices.map((invoice) => (
            <li key={invoice.id} className="group transition-colors hover:bg-slate-50/70 border-l-2 border-transparent hover:border-brand-primary">
              <Link href={`/invoices/${invoice.id}`} className="block px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-900 group-hover:text-brand-primary transition-colors">
                    RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "N/A"}
                  </span>
                  <span className="text-sm font-black text-emerald-600">{formatMoney(invoice.total)}</span>
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-slate-500 font-medium">
                  <span className="truncate max-w-[150px] font-semibold text-slate-700">{invoice.customer.displayName}</span>
                  <span>{formatDate(invoice.invoiceDate)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ActivityCard>

        {/* UNPAID RECEIVABLES */}
        <ActivityCard title="Unpaid Accounts Receivable" href="/accounts-receivable">
          {summary.unpaidInvoices.map((row) => row.invoice ? (
            <li key={row.id} className="group transition-colors hover:bg-slate-50/70 border-l-2 border-transparent hover:border-brand-primary">
              <Link href={`/invoices/${row.invoice.id}`} className="block px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-900 group-hover:text-brand-primary transition-colors">
                    RO #{row.invoice.repairOrderNumber ?? row.invoice.legacyRoNo ?? "N/A"}
                  </span>
                  <span className="inline-flex rounded-md bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600 border border-red-100 shadow-2xs">
                    {formatMoney(row.balance)}
                  </span>
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-slate-500 font-medium">
                  <span className="truncate max-w-[150px] font-semibold text-slate-700">{row.customer.displayName}</span>
                  <span>{formatDate(row.invoice.invoiceDate)}</span>
                </div>
              </Link>
            </li>
          ) : null)}
        </ActivityCard>
      </section>
    </div>
  );
}

// Upgraded inner component to match the table headers
function ActivityCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
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
            No active tracking history segments found.
          </p>
        </div>
      )}
    </article>
  );
}