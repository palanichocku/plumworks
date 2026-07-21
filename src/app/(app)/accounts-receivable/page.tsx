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

  const thClass = "px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 select-none";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header Structure */}
      <PageHeading 
        eyebrow="Billing" 
        title="Accounts Receivable" 
        description="Invoice ledger balances, tracking histories, and global shop payment statuses." 
      />

      {/* Control Strip Pane */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        {/* Premium Segmented Navigation Toggle */}
        <nav className="inline-flex self-start rounded-lg bg-slate-100 p-1 text-xs font-medium" aria-label="Receivable status">
          {(["open", "paid", "all"] as const).map((status) => {
            const query = new URLSearchParams();
            query.set("status", status);
            if (search) query.set("q", search);
            const isActive = filter === status;
            return (
              <Link 
                key={status} 
                href={`/accounts-receivable?${query}`} 
                className={`rounded-md px-4 py-1.5 transition-all capitalize ${
                  isActive 
                    ? "bg-white text-slate-900 shadow-sm font-semibold" 
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {status}
              </Link>
            );
          })}
        </nav>

        {/* Search Engine Field */}
        <form action="/accounts-receivable" className="flex min-w-0 gap-2 lg:w-96">
          <input type="hidden" name="status" value={filter} />
          <label htmlFor="ar-search" className="sr-only">Search by customer or RO number</label>
          <input 
            id="ar-search" 
            name="q" 
            type="search" 
            defaultValue={search} 
            placeholder="Search customer or RO number..." 
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10" 
          />
          <button 
            type="submit" 
            className="rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20"
          >
            Search
          </button>
        </form>
      </div>

      {/* Data Display Conditional Switch */}
      {rows.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">
            No matching balances found
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            No active {filter === "all" ? "receivable" : filter} statement entities correspond with your query parameters.
          </p>
          {search && (
            <Link
              href={`/accounts-receivable?status=${filter}`}
              className="mt-4 inline-block text-xs font-bold uppercase tracking-wider text-brand-primary hover:text-brand-primary"
            >
              Clear search filter
            </Link>
          )}
        </section>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Informational Sub-Panel matching Invoices layout exactly */}
          <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-3 text-xs font-medium text-slate-400 italic">
            Showing localized ledger sequences for {filter === "all" ? "all" : filter} balances
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75">
                  <th className={thClass}>Invoice / RO</th>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Vehicle</th>
                  <th className={thClass}>Total</th>
                  <th className={thClass}>Paid</th>
                  <th className={thClass}>Balance</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row: Receivable) => {
                  const invoice = row.invoice;
                  if (!invoice) return null;
                  
                  const vehicle = invoice.vehicle 
                    ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model].filter(Boolean).join(" ") || "Details unavailable" 
                    : "Not linked";

                  const isPaid = row.status.toLowerCase() === "paid";

                  return (
                    <tr key={row.id} className="group transition-colors hover:bg-slate-50/60">
                      <td className="px-5 py-3.5">
                        <Link href={`/invoices/${invoice.id}`} className="block font-bold text-slate-900 hover:text-brand-primary transition-colors">
                          RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 font-medium whitespace-nowrap">
                        {formatDate(invoice.invoiceDate)}
                      </td>
                      <td className="px-5 py-3.5 text-sm font-semibold text-slate-700 truncate max-w-[160px]">
                        {row.customer.displayName}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 font-medium truncate max-w-[180px]">
                        {vehicle}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 font-medium">
                        {formatMoney(invoice.total)}
                      </td>
                      <td className="px-5 py-3.5 text-emerald-600 font-semibold">
                        {formatMoney(invoice.paidTotal)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-sm font-black ${Number(row.balance) > 0 ? "text-red-600" : "text-slate-400"}`}>
                          {formatMoney(row.balance)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${
                          isPaid 
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-2xs" 
                            : "bg-amber-50 text-amber-700 border-amber-200 shadow-2xs"
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Context Card Footer */}
          <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Showing recent transaction segments
          </div>
        </div>
      )}
    </div>
  );
}
