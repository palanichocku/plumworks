import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import {
  formatDate,
  formatLaborDescription,
  formatMoney,
} from "@/lib/formatters";
import { InvoicePaymentForm } from "@/components/invoice-payment-form";
import { isEditableOpenInvoice } from "@/lib/invoice-lifecycle";
import { EmailInvoiceButton } from "@/components/email-invoice-button";
import { normalizeEmailRecipient } from "@/lib/email/invoice-email-core";
import { invoicePaymentSummary, paymentMethodLabel, paymentPayerLabel, paymentStatusLabel } from "@/lib/invoice-payments";
import { VoidInvoiceButton } from "@/components/void-invoice-button";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { InvoiceDeliverySignaturePanel } from "@/components/invoice-delivery-signature-panel";
import { getInvoiceDeliverySignatureEvidence } from "@/lib/authorization/invoice-signature-evidence";
import { snapshotString } from "@/lib/invoice-snapshots";

type InvoiceDetail = NonNullable<
  Awaited<ReturnType<typeof getInvoiceForCurrentShop>>
>;
type InvoicePart = InvoiceDetail["parts"][number];
type InvoiceLabor = InvoiceDetail["labor"][number];
type InvoicePayment = InvoiceDetail["payments"][number];

export const dynamic = "force-dynamic";

const lineAmount = (quantity: { toString(): string }, price: { toString(): string }) =>
  (Number(quantity.toString()) * Number(price.toString())).toFixed(2);

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { id } = await params;
  const [invoice, query, { membership }, signatureEvidence] = await Promise.all([
    getInvoiceForCurrentShop(id),
    searchParams,
    getCurrentMembership(),
    getInvoiceDeliverySignatureEvidence(id),
  ]);

  if (!invoice) notFound();

  const vehicle = invoice.vehicle
    ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
        .filter(Boolean)
        .join(" ") || "Vehicle details unavailable"
    : null;
  const receivable = invoice.accountsReceivable[0];
  const paymentAmount = receivable?.balance.toFixed(2) ?? "0.00";
  const paymentSummary = invoicePaymentSummary(invoice.total, invoice.paidTotal);
  const displaySubtotalBeforeTax = invoice.partsTotal.plus(invoice.laborTotal).plus(invoice.shopSuppliesAmount).toDecimalPlaces(2);
  const open = isEditableOpenInvoice(invoice);
  const voided = invoice.status === "void";
  const laborWarrantyText = snapshotString(invoice.shopSnapshot, "warrantyText", invoice.shop.warrantyText);
  const authorizationText = snapshotString(invoice.shopSnapshot, "invoiceAuthorizationText", invoice.shop.invoiceAuthorizationText);
  const certificationText = snapshotString(invoice.shopSnapshot, "invoiceCertificationText", invoice.shop.invoiceCertificationText);
  const canVoid = Boolean(membership && hasPermission(membership.role, "finalize_repair_order") && invoice.legacySourceTable === null && invoice.status === "open" && invoice.payments.length === 0);
  const canRecordPayment =
    invoice.legacySourceTable === null &&
    invoice.repairOrderNumber !== null &&
    open &&
    Boolean(receivable?.balance.greaterThan(0));
  const today = new Date().toISOString().slice(0, 10);
  const chargedLabor = invoice.labor.filter((labor: InvoiceLabor) => !labor.complimentary);
  const complimentaryLabor = invoice.labor.filter((labor: InvoiceLabor) => labor.complimentary);
  const lineCount = invoice.parts.length + chargedLabor.length + complimentaryLabor.length;

  return (
    <>
      <Link href="/invoices" className="text-sm font-semibold text-brand-primary hover:text-brand-primary">
        ← Invoices
      </Link>
      <header className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-primary">Invoice</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">
              RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Not recorded"}
            </h1>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
              {voided ? "Void" : open ? `Open · ${paymentStatusLabel(paymentSummary.status)}` : paymentStatusLabel(paymentSummary.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{formatDate(invoice.invoiceDate)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {invoice.repairOrderId ? <Link href={`/repair-orders/${invoice.repairOrderId}/authorization-evidence`} className="rounded-lg border border-brand-primary/30 px-3 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-subtle">Estimate Authorization</Link> : null}
          {canVoid ? <VoidInvoiceButton invoiceId={invoice.id} invoiceNumber={String(invoice.repairOrderNumber)} originalTotal={formatMoney(invoice.total)} /> : null}
          {open ? <Link href={`/invoices/${invoice.id}/edit`} className="rounded-lg border border-brand-primary/30 px-3 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-subtle">Edit Invoice</Link> : null}
          <EmailInvoiceButton
            invoiceId={invoice.id}
            defaultRecipient={normalizeEmailRecipient(invoice.customer.email ?? "") ?? ""}
            status={voided ? "Void" : open ? "Open" : "Closed"}
            printHref={`/invoices/${invoice.id}/print`}
          />
        </div>
      </header>

      {query.payment === "closed" ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Payment recorded. Invoice paid in full and closed.</p> : null}
      {voided ? <div className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4 text-red-900"><p className="text-xl font-black tracking-widest">VOID</p><p className="mt-1 text-sm">Voided {formatDate(invoice.voidedAt)} · Reason: {invoice.voidReason?.replaceAll("_", " ").toLowerCase() ?? "Not recorded"}{invoice.voidNote ? ` · ${invoice.voidNote}` : ""}</p></div> : null}
      {!open && invoice.closedAt ? <p className="mt-4 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">Closed {formatDate(invoice.closedAt)}{invoice.deliveredAt ? ` · Vehicle delivered ${formatDate(invoice.deliveredAt)}` : ""}</p> : null}

      <div className="transaction-workspace-width mt-6 min-w-0 space-y-5">
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-slate-950">Job summary</h2>
            <dl className="mt-3 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</dt>
                <dd className="mt-1"><Link href={`/customers/${invoice.customer.id}`} className="font-semibold text-brand-primary hover:text-brand-primary">{invoice.customer.displayName}</Link></dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle</dt>
                <dd className="mt-1">{invoice.vehicle ? <Link href={`/vehicles/${invoice.vehicle.id}`} className="font-semibold text-brand-primary hover:text-brand-primary">{vehicle}</Link> : <span className="text-slate-700">Vehicle not linked</span>}</dd>
              </div>
            </dl>
            {(invoice.customerComplaint || invoice.recommendation) ? <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
              {invoice.customerComplaint ? <div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer complaint</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{invoice.customerComplaint}</p></div> : null}
              {invoice.recommendation ? <div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shop recommendation</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{invoice.recommendation}</p></div> : null}
            </div> : null}
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balance due</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{voided ? "$0.00" : receivable ? formatMoney(receivable.balance) : "Unavailable"}</p>
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Parts</dt><dd className="text-right">{formatMoney(invoice.partsTotal)}</dd>
              <dt className="text-slate-500">Labor</dt><dd className="text-right">{formatMoney(invoice.laborTotal)}</dd>
              <dt className="text-slate-500">Shop supplies</dt><dd className="text-right">{formatMoney(invoice.shopSuppliesAmount)}</dd>
              <dt className="text-slate-500">Subtotal before tax</dt><dd className="text-right">{formatMoney(displaySubtotalBeforeTax)}</dd>
              {!invoice.discountAmount.isZero() ? <><dt className="text-slate-500">Discount</dt><dd className="text-right">{formatMoney(invoice.discountAmount.negated())}</dd></> : null}
              <dt className="text-slate-500">Tax</dt><dd className="text-right">{formatMoney(invoice.taxTotal)}</dd>
              <dt className="border-t border-slate-200 pt-3 font-semibold text-slate-950">{voided ? "Original total" : "Total"}</dt><dd className="border-t border-slate-200 pt-3 text-right font-semibold text-slate-950">{formatMoney(invoice.total)}</dd>
              <dt className="text-slate-500">Paid</dt><dd className="text-right">{formatMoney(invoice.paidTotal)}</dd>
            </dl>
            {open && receivable?.balance.greaterThan(0) ? <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This invoice stays open until the remaining balance is paid.</p> : null}
          </section>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Line items</h2>
              <p className="mt-0.5 text-xs text-slate-500">{lineCount} {lineCount === 1 ? "item" : "items"}</p>
            </div>
            <div className="text-sm font-semibold text-slate-700">Parts {formatMoney(invoice.partsTotal)} <span className="mx-1 text-slate-300">·</span> Labor {formatMoney(invoice.laborTotal)}</div>
          </div>
          <div className="hidden grid-cols-[7rem_minmax(0,1fr)_7rem_8rem_7rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid sm:px-5">
            <span>Type</span><span>Description</span><span className="text-right">Qty / Hrs</span><span className="text-right">Price / Rate</span><span className="text-right">Amount</span>
          </div>
          <ul className="divide-y divide-slate-200">
            {invoice.parts.map((part: InvoicePart) => (
              <li key={part.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[7rem_minmax(0,1fr)_7rem_8rem_7rem] md:items-center md:gap-3 sm:px-5">
                <span><span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Part</span></span>
                <span className="min-w-0"><span className="block font-medium text-slate-950">{part.description}</span>{part.partNumber ? <span className="mt-0.5 block text-xs text-slate-500">{part.partNumber}</span> : null}</span>
                <span className="text-slate-600 md:text-right">{part.quantity.toString()}</span>
                <span className="text-slate-600 md:text-right">{formatMoney(part.unitPrice)}</span>
                <span className="font-semibold text-slate-950 md:text-right">{formatMoney(lineAmount(part.quantity, part.unitPrice))}</span>
              </li>
            ))}
            {chargedLabor.map((labor: InvoiceLabor) => (
              <li key={labor.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[7rem_minmax(0,1fr)_7rem_8rem_7rem] md:items-center md:gap-3 sm:px-5">
                <span><span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Labor</span></span>
                <span className="min-w-0 font-medium text-slate-950">{formatLaborDescription(labor.description)}</span>
                <span className="text-slate-600 md:text-right">{labor.hours.toString()}</span>
                <span className="text-slate-600 md:text-right">{formatMoney(labor.hourlyRate)}/hr</span>
                <span className="font-semibold text-slate-950 md:text-right">{formatMoney(lineAmount(labor.hours, labor.hourlyRate))}</span>
              </li>
            ))}
            {complimentaryLabor.map((labor: InvoiceLabor) => (
              <li key={labor.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[7rem_minmax(0,1fr)_7rem_8rem_7rem] md:items-center md:gap-3 sm:px-5">
                <span><span className="inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">Complimentary</span></span>
                <span className="min-w-0 font-medium text-slate-950">{formatLaborDescription(labor.description)}</span>
                <span className="text-slate-400 md:text-right">—</span>
                <span className="text-slate-400 md:text-right">—</span>
                <span className="font-semibold text-emerald-700 md:text-right">No charge</span>
              </li>
            ))}
            {lineCount === 0 ? <li className="px-5 py-5 text-sm text-slate-600">No line items are recorded for this invoice.</li> : null}
          </ul>
        </section>

        {canRecordPayment ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Record payment</h2>
                <p className="mt-1 text-sm text-slate-600">Payments cannot exceed the current balance of {formatMoney(receivable?.balance)}.</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balance due</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-950">{formatMoney(receivable?.balance)}</p>
              </div>
            </div>
            <InvoicePaymentForm key={paymentAmount} invoiceId={invoice.id} remainingBalance={paymentAmount} paymentDate={today} />
          </section>
        ) : invoice.legacySourceTable ? (
          <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">Imported legacy invoice — payment recording is read-only.</p>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Payment history</h2>
              <p className="mt-0.5 text-xs text-slate-500">Paid {formatMoney(invoice.paidTotal)} · Remaining {receivable ? formatMoney(receivable.balance) : "Unavailable"}</p>
            </div>
          </div>
          {invoice.legacySourceTable ? (
            <p className="px-5 py-4 text-sm text-slate-600">Itemized payment history is unavailable for imported legacy invoices.</p>
          ) : invoice.payments.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-600">No payments have been recorded for this invoice.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {invoice.payments.map((payment: InvoicePayment) => (
                <li key={payment.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(7rem,auto)_minmax(7rem,auto)_minmax(8rem,auto)_1fr_auto] sm:items-center">
                  <span className="text-sm font-medium text-slate-900">{formatDate(payment.paidAt)}</span>
                  <span className="text-sm text-slate-600">{paymentPayerLabel(payment.payerType)}</span>
                  <span className="text-sm text-slate-600">{paymentMethodLabel(payment.method)}</span>
                  <span className="text-sm text-slate-600">{[payment.reference?.trim(), payment.note?.trim()].filter(Boolean).join(" · ") || "No reference or note"}</span>
                  <span className="font-semibold text-slate-950">{formatMoney(payment.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {signatureEvidence && invoice.legacySourceTable === null && !voided ? <InvoiceDeliverySignaturePanel
          invoiceId={invoice.id}
          invoiceNumber={`RO #${invoice.repairOrderNumber ?? "—"}`}
          vehicleLabel={vehicle ?? "Vehicle not linked"}
          totalLabel={formatMoney(invoice.total)}
          defaultCustomerName={invoice.customer.displayName}
          currentComplete={signatureEvidence.currentComplete}
          signatures={signatureEvidence.signatures.map((row) => ({
            eventId: row.eventId,
            sessionId: row.sessionId,
            role: row.role,
            signerName: row.signerName,
            occurredAt: row.occurredAt.toISOString(),
            staffUserEmail: row.staffUserEmail,
            signatureData: row.signatureData,
            signatureSha256: row.signatureSha256,
            revision: row.revision,
            snapshotSha256: row.snapshotSha256,
          }))}
        /> : null}

        {(laborWarrantyText || authorizationText || certificationText) ? (
          <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Invoice Terms &amp; Certification</h2>
                <p className="mt-0.5 text-xs text-slate-500">Warranty, authorization and certification details</p>
              </div>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div className="space-y-5 border-t border-slate-200 px-4 py-4 sm:px-5">
              {laborWarrantyText ? <LegalSection title="Labor Warranty" text={laborWarrantyText} /> : null}
              {authorizationText ? <LegalSection title="Customer Authorization" text={authorizationText} /> : null}
              {certificationText ? <LegalSection title="Certification" text={certificationText} /> : null}
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}

function LegalSection({ title, text }: { title: string; text: string }) {
  return <div>
    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{text}</p>
  </div>;
}
