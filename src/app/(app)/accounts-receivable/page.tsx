import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import {
  getAccountsReceivableForCurrentShop,
  type ReceivableFilter,
} from "@/lib/data/accounts-receivable";
import { formatDate, formatMoney } from "@/lib/formatters";

type Receivable = Awaited<
  ReturnType<typeof getAccountsReceivableForCurrentShop>
>[number];

export const dynamic = "force-dynamic";

export default async function AccountsReceivablePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const filter: ReceivableFilter = ["open", "paid", "all"].includes(params.status ?? "")
    ? params.status as ReceivableFilter
    : "open";
  const search = params.q?.trim() ?? "";
  const rows = await getAccountsReceivableForCurrentShop(filter, search);

  return <>
    <PageHeading eyebrow="Billing" title="Accounts Receivable" description="Invoice balances and payment status for the current shop." />
    <div className="mb-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <nav className="flex gap-2" aria-label="Receivable status">
        {(["open", "paid", "all"] as const).map((status) => {
          const query = new URLSearchParams();
          query.set("status", status);
          if (search) query.set("q", search);
          return <Link key={status} href={`/accounts-receivable?${query}`} className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize ${filter === status ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{status}</Link>;
        })}
      </nav>
      <form action="/accounts-receivable" className="flex min-w-0 gap-2 lg:w-96">
        <input type="hidden" name="status" value={filter} />
        <label htmlFor="ar-search" className="sr-only">Search by customer or RO number</label>
        <input id="ar-search" name="q" type="search" defaultValue={search} placeholder="Customer or RO number" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Search</button>
      </form>
    </div>

    {rows.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm"><h2 className="text-xl font-semibold text-slate-950">No matching balances</h2><p className="mt-2 text-sm text-slate-600">No {filter === "all" ? "receivable" : filter} invoice balances match this view.</p></section> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3">Invoice / RO</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Vehicle</th><th className="px-5 py-3 text-right">Total</th><th className="px-5 py-3 text-right">Paid</th><th className="px-5 py-3 text-right">Balance</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-200">{rows.map((row: Receivable) => {
      const invoice = row.invoice;
      if (!invoice) return null;
      const vehicle = invoice.vehicle ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model].filter(Boolean).join(" ") || "Details unavailable" : "Not linked";
      return <tr key={row.id} className="hover:bg-slate-50"><td className="px-5 py-4"><Link href={`/invoices/${invoice.id}`} className="font-semibold text-sky-700 hover:text-sky-800">RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Not recorded"}</Link></td><td className="px-5 py-4 text-slate-600">{formatDate(invoice.invoiceDate)}</td><td className="px-5 py-4 text-slate-900">{row.customer.displayName}</td><td className="px-5 py-4 text-slate-600">{vehicle}</td><td className="px-5 py-4 text-right">{formatMoney(invoice.total)}</td><td className="px-5 py-4 text-right">{formatMoney(invoice.paidTotal)}</td><td className="px-5 py-4 text-right font-semibold">{formatMoney(row.balance)}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${row.status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{row.status}</span></td></tr>;
    })}</tbody></table></div><p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">Showing up to 50 records.</p></section>}
  </>;
}
