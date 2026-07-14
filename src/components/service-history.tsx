import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/formatters";

type ServiceHistoryItem = {
  id: string;
  legacyRoNo: string | null;
  invoiceDate: Date | null;
  total: { toString(): string };
  vehicle?: {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
  } | null;
  customer?: { id: string; displayName: string };
};

export function ServiceHistory({
  invoices,
  showVehicle = false,
  showCustomer = false,
}: {
  invoices: ServiceHistoryItem[];
  showVehicle?: boolean;
  showCustomer?: boolean;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5">
        <h2 className="text-lg font-semibold text-slate-950">Service history</h2>
        <p className="mt-1 text-sm text-slate-600">Most recent 50 invoices.</p>
      </div>
      {invoices.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-600">
          No service history is available.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {invoices.map((invoice) => {
            const vehicle = invoice.vehicle
              ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
                  .filter(Boolean)
                  .join(" ") || "Vehicle details unavailable"
              : "Vehicle not linked";

            return (
              <li key={invoice.id}>
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="grid gap-2 px-6 py-4 transition hover:bg-slate-50 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                >
                  <span>
                    <span className="block font-semibold text-slate-950">
                      RO #{invoice.legacyRoNo ?? "Not recorded"}
                    </span>
                    <span className="text-sm text-slate-500">
                      {formatDate(invoice.invoiceDate)}
                    </span>
                  </span>
                  <span className="text-sm text-slate-600">
                    {showVehicle ? vehicle : null}
                    {showCustomer ? invoice.customer?.displayName ?? "Customer unavailable" : null}
                  </span>
                  <span className="font-medium text-slate-900">
                    {formatMoney(invoice.total)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
