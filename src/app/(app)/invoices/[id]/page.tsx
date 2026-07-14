import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import { formatDate, formatMoney } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoiceForCurrentShop(id);

  if (!invoice) notFound();

  const vehicle = invoice.vehicle
    ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
        .filter(Boolean)
        .join(" ") || "Vehicle details unavailable"
    : null;
  const receivable = invoice.accountsReceivable[0];

  return (
    <>
      <Link href="/invoices" className="text-sm font-semibold text-sky-700 hover:text-sky-800">
        ← Invoices
      </Link>
      <header className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-sky-700">Invoice</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            RO #{invoice.legacyRoNo ?? "Not recorded"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{formatDate(invoice.invoiceDate)}</p>
        </div>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-medium capitalize text-slate-700">
          {invoice.status}
        </span>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Customer and vehicle</h2>
          <div className="mt-5 space-y-4 text-sm">
            <div>
              <p className="text-slate-500">Customer</p>
              <Link href={`/customers/${invoice.customer.id}`} className="mt-1 inline-block font-semibold text-sky-700 hover:text-sky-800">
                {invoice.customer.displayName}
              </Link>
            </div>
            <div>
              <p className="text-slate-500">Vehicle</p>
              {invoice.vehicle ? (
                <Link href={`/vehicles/${invoice.vehicle.id}`} className="mt-1 inline-block font-semibold text-sky-700 hover:text-sky-800">
                  {vehicle}
                </Link>
              ) : (
                <p className="mt-1 text-slate-700">Vehicle not linked</p>
              )}
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Totals and balance</h2>
          <dl className="mt-5 grid grid-cols-[1fr_auto] gap-3 text-sm">
            <dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(invoice.subtotal)}</dd>
            <dt className="text-slate-500">Tax</dt><dd>{formatMoney(invoice.taxTotal)}</dd>
            <dt className="border-t border-slate-200 pt-3 font-semibold text-slate-900">Total</dt>
            <dd className="border-t border-slate-200 pt-3 font-semibold">{formatMoney(invoice.total)}</dd>
            <dt className="text-slate-500">Balance</dt>
            <dd>{receivable ? formatMoney(receivable.balance) : "Unavailable"}</dd>
          </dl>
        </article>
      </section>

      <LineSection title="Parts" empty="No parts are recorded for this invoice.">
        {invoice.parts.map((part) => (
          <li key={part.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <span><span className="block font-medium text-slate-950">{part.description}</span><span className="text-sm text-slate-500">{part.partNumber ?? "No part number"}</span></span>
            <span className="text-sm text-slate-600">Qty {part.quantity.toString()}</span>
            <span className="font-medium text-slate-900">{formatMoney(part.unitPrice)}</span>
          </li>
        ))}
      </LineSection>

      <LineSection title="Labor" empty="No labor is recorded for this invoice.">
        {invoice.labor.map((labor) => (
          <li key={labor.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <span className="font-medium text-slate-950">{labor.description}</span>
            <span className="text-sm text-slate-600">{labor.hours.toString()} hours</span>
            <span className="font-medium text-slate-900">{formatMoney(labor.hourlyRate)}/hr</span>
          </li>
        ))}
      </LineSection>
    </>
  );
}

function LineSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5"><h2 className="text-lg font-semibold text-slate-950">{title}</h2></div>
      {items.length === 0 ? <p className="px-6 py-8 text-sm text-slate-600">{empty}</p> : <ul className="divide-y divide-slate-200">{children}</ul>}
    </section>
  );
}
