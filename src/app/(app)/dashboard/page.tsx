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
  const role = membership
    ? membership.role.charAt(0) + membership.role.slice(1).toLowerCase()
    : null;

  if (!shop || !summary) return <><PageHeading eyebrow="Overview" title="Dashboard" description="Your connected Car Doc shop workspace." /><section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm"><h2 className="text-xl font-semibold text-slate-950">No shop membership found</h2></section></>;

  const cards = [
    ["Open repair orders", summary.openRepairOrders, "/repair-orders"],
    ["Web draft/open orders", summary.webRepairOrders, "/repair-orders"],
    ["Open receivables", summary.openReceivables, "/accounts-receivable"],
    ["Open AR balance", formatMoney(summary.openReceivableBalance), "/accounts-receivable"],
    ["Customers", summary.customers, "/customers"],
    ["Vehicles", summary.vehicles, "/vehicles"],
    ["Invoices, last 30 days", summary.recentInvoiceCount, "/invoices"],
  ] as const;

  return <>
    <PageHeading eyebrow="Overview" title="Dashboard" description="Current shop activity, repair work, and receivables." />
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-sm font-semibold uppercase tracking-wider text-sky-700">Your shop</p><h2 className="mt-2 text-2xl font-bold text-slate-950">{shop.name}</h2><p className="mt-2 text-sm text-slate-600">{[shop.city, shop.state].filter(Boolean).join(", ")}</p></div><div className="text-right"><span className="inline-flex rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Database connected</span><p className="mt-2 text-sm text-slate-600">Role: <span className="font-semibold text-slate-900">{role}</span></p></div></div></section>

    <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, href]) => <Link key={label} href={href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-300 hover:shadow-md"><p className="text-sm font-medium text-slate-600">{label}</p><p className="mt-2 text-2xl font-bold text-slate-950">{value}</p></Link>)}</section>

    <section className="mt-6 grid gap-6 xl:grid-cols-3">
      <ActivityCard title="Recent repair orders" href="/repair-orders">{summary.recentRepairOrders.map((order) => <li key={order.id}><Link href={order.legacySourceTable ? `/open-orders/${order.id}` : `/repair-orders/${order.id}`} className="block px-5 py-4 hover:bg-slate-50"><div className="flex justify-between gap-3"><span className="font-semibold text-slate-950">RO #{order.repairOrderNumber ?? order.legacyRoNo ?? "Not recorded"}</span><span className="text-xs font-semibold uppercase text-slate-500">{order.status}</span></div><p className="mt-1 truncate text-sm text-slate-600">{order.customer.displayName} · {formatDate(order.openedAt)}</p></Link></li>)}</ActivityCard>
      <ActivityCard title="Recent invoices" href="/invoices">{summary.recentInvoices.map((invoice) => <li key={invoice.id}><Link href={`/invoices/${invoice.id}`} className="block px-5 py-4 hover:bg-slate-50"><div className="flex justify-between gap-3"><span className="font-semibold text-slate-950">RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Not recorded"}</span><span className="font-semibold text-slate-900">{formatMoney(invoice.total)}</span></div><p className="mt-1 truncate text-sm text-slate-600">{invoice.customer.displayName} · {formatDate(invoice.invoiceDate)}</p></Link></li>)}</ActivityCard>
      <ActivityCard title="Unpaid invoices" href="/accounts-receivable">{summary.unpaidInvoices.map((row) => row.invoice ? <li key={row.id}><Link href={`/invoices/${row.invoice.id}`} className="block px-5 py-4 hover:bg-slate-50"><div className="flex justify-between gap-3"><span className="font-semibold text-slate-950">RO #{row.invoice.repairOrderNumber ?? row.invoice.legacyRoNo ?? "Not recorded"}</span><span className="font-semibold text-amber-700">{formatMoney(row.balance)}</span></div><p className="mt-1 truncate text-sm text-slate-600">{row.customer.displayName} · {formatDate(row.invoice.invoiceDate)}</p></Link></li> : null)}</ActivityCard>
    </section>
  </>;
}

function ActivityCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">{title}</h2><Link href={href} className="text-sm font-semibold text-sky-700">View all</Link></header>{items.length ? <ul className="divide-y divide-slate-200">{children}</ul> : <p className="px-5 py-8 text-sm text-slate-600">No recent activity.</p>}</article>;
}
