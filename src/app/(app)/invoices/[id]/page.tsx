import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import {
  formatDate,
  formatLaborDescription,
  formatMoney,
} from "@/lib/formatters";
import { recordPayment } from "../payment-actions";
import { FormSubmitButton } from "@/components/form-submit-button";

type InvoiceDetail = NonNullable<
  Awaited<ReturnType<typeof getInvoiceForCurrentShop>>
>;
type InvoicePart = InvoiceDetail["parts"][number];
type InvoiceLabor = InvoiceDetail["labor"][number];
type InvoicePayment = InvoiceDetail["payments"][number];

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
  const balance = Number(receivable?.balance ?? 0);
  const canRecordPayment =
    invoice.legacySourceTable === null &&
    invoice.repairOrderNumber !== null &&
    invoice.status === "finalized" &&
    balance > 0;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Link href="/invoices" className="text-sm font-semibold text-sky-700 hover:text-sky-800">
        ← Invoices
      </Link>
      <header className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-sky-700">Invoice</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Not recorded"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{formatDate(invoice.invoiceDate)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-medium capitalize text-slate-700">
            {invoice.status}
          </span>
          <Link
            href={`/invoices/${invoice.id}/print`}
            className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700"
          >
            Print
          </Link>
        </div>
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
            <dt className="text-slate-500">Parts</dt><dd>{formatMoney(invoice.partsTotal)}</dd>
            <dt className="text-slate-500">Labor</dt><dd>{formatMoney(invoice.laborTotal)}</dd>
            <dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(invoice.subtotal)}</dd>
            <dt className="text-slate-500">Tax</dt><dd>{formatMoney(invoice.taxTotal)}</dd>
            <dt className="border-t border-slate-200 pt-3 font-semibold text-slate-900">Total</dt>
            <dd className="border-t border-slate-200 pt-3 font-semibold">{formatMoney(invoice.total)}</dd>
            <dt className="text-slate-500">Paid</dt><dd>{formatMoney(invoice.paidTotal)}</dd>
            <dt className="text-slate-500">Balance</dt>
            <dd>{receivable ? formatMoney(receivable.balance) : "Unavailable"}</dd>
          </dl>
        </article>
      </section>

      {canRecordPayment ? (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Record payment</h2>
          <p className="mt-2 text-sm text-slate-600">Payments cannot exceed the current balance of {formatMoney(receivable?.balance)}.</p>
          <form action={recordPayment} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <label className="text-sm font-semibold text-slate-700">Amount<input name="amount" type="number" required min="0.01" max={balance.toFixed(2)} step="0.01" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-700">Method<select name="method" required defaultValue="card" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="other">Other</option></select></label>
            <label className="text-sm font-semibold text-slate-700">Payment date<input name="paymentDate" type="date" required defaultValue={today} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <FormSubmitButton pendingLabel="Recording…" confirmTitle="Record this payment?" confirmDescription="Verify the amount, payment method, and date before continuing. This payment cannot be edited or deleted yet." confirmLabel="Record payment" className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">Record payment</FormSubmitButton>
            <label className="text-sm font-semibold text-slate-700 md:col-span-2 lg:col-span-4">Note <span className="font-normal text-slate-500">(optional)</span><textarea name="note" maxLength={500} rows={2} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          </form>
        </section>
      ) : invoice.legacySourceTable ? (
        <p className="mt-6 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">Imported legacy invoice — payment recording is read-only.</p>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Payment History</h2>
            <p className="mt-1 text-sm text-slate-600">
              Total paid {formatMoney(invoice.paidTotal)} · Remaining {receivable ? formatMoney(receivable.balance) : "Unavailable"}
            </p>
          </div>
        </div>
        {invoice.legacySourceTable ? (
          <p className="px-6 py-8 text-sm text-slate-600">
            Itemized payment history is unavailable for imported legacy invoices. Paid and balance totals are shown above.
          </p>
        ) : invoice.payments.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-600">No payments have been recorded for this invoice.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {invoice.payments.map((payment: InvoicePayment) => (
              <li key={payment.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[minmax(8rem,auto)_minmax(7rem,auto)_1fr_auto] sm:items-center">
                <span className="text-sm font-medium text-slate-900">{formatDate(payment.paidAt)}</span>
                <span className="text-sm capitalize text-slate-600">{payment.method?.trim() || "Not specified"}</span>
                <span className="text-sm text-slate-600">{payment.reference?.trim() || "No reference or note"}</span>
                <span className="font-semibold text-slate-950">{formatMoney(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LineSection title="Parts" empty="No parts are recorded for this invoice.">
        {invoice.parts.map((part: InvoicePart) => (
          <li key={part.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <span><span className="block font-medium text-slate-950">{part.description}</span><span className="text-sm text-slate-500">{part.partNumber ?? "No part number"}</span></span>
            <span className="text-sm text-slate-600">Qty {part.quantity.toString()}</span>
            <span className="font-medium text-slate-900">{formatMoney(part.unitPrice)}</span>
          </li>
        ))}
      </LineSection>

      <LineSection title="Labor" empty="No labor is recorded for this invoice.">
        {invoice.labor.map((labor: InvoiceLabor) => (
          <li key={labor.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <span className="font-medium text-slate-950">
              {formatLaborDescription(labor.description)}
            </span>
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
