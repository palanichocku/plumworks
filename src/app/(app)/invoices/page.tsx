import Link from "next/link";
import { Pagination, parsePage } from "@/components/pagination";
import { PageHeading } from "@/components/page-heading";
import { getInvoicesForCurrentShop } from "@/lib/data/invoices";
import { formatDate, formatMoney } from "@/lib/formatters";

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

  return (
    <>
      <PageHeading
        eyebrow="Billing"
        title="Invoices"
        description="Recent invoice and service history for your current shop."
      />

      <form
        action="/invoices"
        className="mb-6 flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label htmlFor="invoice-search" className="sr-only">
          Search invoices
        </label>
        <input
          id="invoice-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Search RO, customer, vehicle, or license"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        />
        <button
          type="submit"
          className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700"
        >
          Search
        </button>
      </form>

      {invoices.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">
            {search ? "No matching invoices" : "No invoices yet"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {search
              ? "Try a different RO number, customer, vehicle, or license."
              : "Invoice records for this shop will appear here."}
          </p>
          {search && (
            <Link
              href="/invoices"
              className="mt-5 inline-block text-sm font-semibold text-sky-700 hover:text-sky-800"
            >
              Clear search
            </Link>
          )}
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 text-sm text-slate-600">
            {search
              ? `Showing up to 50 matches for “${search}”`
              : "Showing the most recent 50 invoices"}
          </div>
          <ul className="divide-y divide-slate-200">
            {invoices.map((invoice) => {
              const vehicle = invoice.vehicle
                ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
                    .filter(Boolean)
                    .join(" ") || "Vehicle details unavailable"
                : "Vehicle not linked";
              const balance = invoice.accountsReceivable[0]?.balance;

              return (
                <li key={invoice.id}>
                  <Link
                    href={`/invoices/${invoice.id}`}
                    className="grid gap-2 px-5 py-4 transition hover:bg-slate-50 md:grid-cols-[0.8fr_1.2fr_1.2fr_0.8fr_0.8fr] md:items-center"
                  >
                    <span>
                      <span className="block font-semibold text-slate-950">
                        RO #{invoice.legacyRoNo ?? "Not recorded"}
                      </span>
                      <span className="text-sm text-slate-500">
                        {formatDate(invoice.invoiceDate)}
                      </span>
                    </span>
                    <span className="truncate text-sm text-slate-700">
                      {invoice.customer.displayName}
                    </span>
                    <span className="truncate text-sm text-slate-600">{vehicle}</span>
                    <span className="text-sm font-medium text-slate-900">
                      {formatMoney(invoice.total)}
                    </span>
                    <span className="text-sm text-slate-600">
                      Balance {balance ? formatMoney(balance) : "unavailable"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <Pagination
        pathname="/invoices"
        page={page}
        hasNext={hasNext}
        search={search}
      />
    </>
  );
}
