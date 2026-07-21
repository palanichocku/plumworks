import Link from "next/link";
import { Pagination, parsePage } from "@/components/pagination";
import { PageHeading } from "@/components/page-heading";
import { getInvoicesForCurrentShop } from "@/lib/data/invoices";
import { formatDate, formatMoney } from "@/lib/formatters";

type InvoicesResult = Awaited<ReturnType<typeof getInvoicesForCurrentShop>>;
type InvoiceListItem = InvoicesResult["invoices"][number];

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page: pageParam, q } = await searchParams;
  const page = parsePage(pageParam);
  const search = q?.trim() ?? "";
  const { invoices, hasNext } = await getInvoicesForCurrentShop(search, page);

  // Upgraded header styling for better contrast and visual weight
  const thClass = "px-5 py-4 text-xs font-extrabold uppercase tracking-widest text-slate-700 select-none";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Billing"
        title="Invoices"
        description="Recent invoice ledger balances and historically settled customer invoices."
      />

      <form
        action="/invoices"
        className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label htmlFor="invoice-search" className="sr-only">
          Search invoices
        </label>
        <input
          id="invoice-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Search by RO number, customer name, vehicle, or license..."
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10"
        />
        <button
          type="submit"
          className="rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20"
        >
          Search
        </button>
      </form>

      {invoices.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">
            {search ? "No matching invoices found" : "No invoices yet"}
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            {search
              ? "Try typing alternative repair indices or check digits."
              : "Settled repair folders catalog under live shop billing records automatically."}
          </p>
          {search && (
            <Link
              href="/invoices"
              className="mt-4 inline-block text-xs font-bold uppercase tracking-wider text-brand-primary hover:text-brand-primary"
            >
              Clear filter view
            </Link>
          )}
        </section>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Matched the slightly deeper sub-header styling */}
          <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-3 text-xs font-semibold text-slate-500">
            {search
              ? `Showing localized sequence results matching “${search}”`
              : "Showing most recent batch ledger invoices"}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                {/* Beefed up the background and border of the table header row */}
                <tr className="border-b-2 border-slate-200 bg-slate-100/80">
                  <th className={thClass}>Invoice / RO</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Linked Vehicle</th>
                  <th className={thClass}>Total</th>
                  <th className={thClass}>Balance Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {invoices.map((invoice: InvoiceListItem) => {
                  const vehicleDescription = invoice.vehicle
                    ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
                        .filter(Boolean)
                        .join(" ") || "Vehicle details unavailable"
                    : "Vehicle not linked";
                  
                  const balance = invoice.accountsReceivable[0]?.balance;

                  return (
                    <tr key={invoice.id} className="group transition-colors hover:bg-slate-50/60">
                      <td className="px-5 py-4 text-sm">
                        <Link href={`/invoices/${invoice.id}`} className="block font-bold text-slate-900 hover:text-brand-primary transition-colors">
                          RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}
                        </Link>
                        <span className="block text-xs font-medium text-slate-400 mt-0.5">
                          {formatDate(invoice.invoiceDate)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-slate-700 truncate max-w-[180px]">
                        {invoice.customer.displayName}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500 font-medium truncate max-w-[200px]">
                        {vehicleDescription}
                      </td>
                      <td className="px-5 py-4 text-sm font-black text-slate-900">
                        {formatMoney(invoice.total)}
                      </td>
                      <td className="px-5 py-4 text-sm font-medium">
                        {balance && Number(balance) > 0 ? (
                          <span className="inline-flex rounded-md bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600 border border-red-100 shadow-2xs">
                            {formatMoney(balance)}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-400">Paid In Full</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination
        pathname="/invoices"
        page={page}
        hasNext={hasNext}
        search={search}
      />
    </div>
  );
}