import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { getInvoicesForCurrentShop } from "@/lib/data/invoices";
import { formatDate, formatMoney } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const invoices = await getInvoicesForCurrentShop();

  return (
    <>
      <PageHeading
        eyebrow="Billing"
        title="Invoices"
        description="Recent invoice and service history for your current shop."
      />
      {invoices.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">No invoices yet</h2>
          <p className="mt-2 text-sm text-slate-600">
            Invoice records for this shop will appear here.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 text-sm text-slate-600">
            Showing the most recent 50 invoices
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
    </>
  );
}
