import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RevisionRow = {
  revision: number;
  snapshot: unknown;
  snapshotSha256: string;
  total: string;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function money(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(typeof value === "string" ? value : NaN);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";
}

function dateTime(value: unknown) {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("en-US", { timeZone: "America/Detroit" });
}

function shortHash(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-12)}` : value;
}

export default async function InvoiceRevisionPage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision: revisionParam } = await params;
  const revision = Number.parseInt(revisionParam, 10);
  if (!UUID.test(id) || !Number.isInteger(revision) || revision < 1) notFound();

  const { membership } = await getCurrentMembership();
  if (!membership) notFound();

  const rows = await prisma.$queryRaw<RevisionRow[]>`
    SELECT
      revision,
      snapshot,
      snapshot_sha256 AS "snapshotSha256",
      total::text AS total
    FROM document_revisions
    WHERE shop_id = ${membership.shopId}::uuid
      AND document_type = 'INVOICE'::"DocumentEvidenceType"
      AND document_id = ${id}::uuid
      AND revision = ${revision}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) notFound();

  const snapshot = record(row.snapshot);
  const invoice = record(snapshot.invoice);
  const shop = record(snapshot.shop);
  const customer = record(snapshot.customer);
  const vehicle = record(snapshot.vehicle);
  const totals = record(snapshot.totals);
  const parts = list(snapshot.parts);
  const labor = list(snapshot.labor);
  const repairOrderNumber = text(invoice.number, "Not recorded");
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].map((value) => text(value, "")).filter(Boolean).join(" ") || "Vehicle not recorded";
  const complaint = optionalText(invoice.customerComplaint);
  const recommendation = optionalText(invoice.recommendation);

  return (
    <>
      <Link href={`/invoices/${id}`} className="text-sm font-semibold text-brand-primary hover:text-brand-primary">
        ← Current invoice
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-primary">Immutable Invoice Snapshot</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">RO #{repairOrderNumber} · Revision {row.revision}</h1>
          <p className="mt-2 text-sm text-slate-600">Invoice date {dateTime(invoice.invoiceDate)}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">Read-only historical revision</span>
      </header>

      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        This is the exact invoice snapshot retained when delivery signatures were captured. It cannot be edited and does not change when the current invoice changes.
      </div>

      <div className="transaction-workspace-width mt-6 min-w-0 space-y-5">
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Revision details</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</dt><dd className="mt-1 font-semibold text-slate-900">{text(customer.displayName)}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle</dt><dd className="mt-1 font-semibold text-slate-900">{vehicleLabel}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mileage</dt><dd className="mt-1 text-slate-800">{invoice.odometer == null ? "—" : `${text(invoice.odometer)} mi`}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shop</dt><dd className="mt-1 text-slate-800">{text(shop.name)}</dd></div>
            </dl>
            {(complaint || recommendation) ? (
              <div className="mt-5 grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2">
                {complaint ? <div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer complaint</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{complaint}</p></div> : null}
                {recommendation ? <div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shop recommendation</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{recommendation}</p></div> : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revision total</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{money(totals.total ?? row.total)}</p>
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Parts</dt><dd className="text-right">{money(totals.parts)}</dd>
              <dt className="text-slate-500">Labor</dt><dd className="text-right">{money(totals.labor)}</dd>
              <dt className="text-slate-500">Shop supplies</dt><dd className="text-right">{money(totals.shopSupplies)}</dd>
              <dt className="text-slate-500">Discount</dt><dd className="text-right">{money(totals.discount)}</dd>
              <dt className="text-slate-500">Tax</dt><dd className="text-right">{money(totals.tax)}</dd>
              <dt className="border-t border-slate-200 pt-3 font-semibold text-slate-950">Total</dt><dd className="border-t border-slate-200 pt-3 text-right font-semibold text-slate-950">{money(totals.total ?? row.total)}</dd>
              <dt className="text-slate-500">Paid at snapshot</dt><dd className="text-right">{money(totals.paid)}</dd>
            </dl>
          </section>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Line items in revision {row.revision}</h2>
            <p className="mt-1 text-xs text-slate-500">{parts.length + labor.length} saved line items</p>
          </div>
          <div className="divide-y divide-slate-200">
            {parts.map((part, index) => (
              <div key={`part-${index}`} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[7rem_minmax(0,1fr)_7rem_8rem_7rem] md:items-center md:gap-3">
                <span><span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Part</span></span>
                <span><span className="block font-medium text-slate-950">{text(part.description)}</span>{optionalText(part.partNumber) ? <span className="mt-0.5 block text-xs text-slate-500">{text(part.partNumber)}</span> : null}</span>
                <span className="text-slate-600 md:text-right">{text(part.quantity)}</span>
                <span className="text-slate-600 md:text-right">{money(part.unitPrice)}</span>
                <span className="font-semibold text-slate-950 md:text-right">{money(part.lineTotal)}</span>
              </div>
            ))}
            {labor.map((line, index) => {
              const complimentary = line.complimentary === true;
              return (
                <div key={`labor-${index}`} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[7rem_minmax(0,1fr)_7rem_8rem_7rem] md:items-center md:gap-3">
                  <span><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${complimentary ? "bg-violet-50 text-violet-700" : "bg-emerald-50 text-emerald-700"}`}>{complimentary ? "Complimentary" : "Labor"}</span></span>
                  <span className="font-medium text-slate-950">{text(line.description)}</span>
                  <span className="text-slate-600 md:text-right">{complimentary ? "—" : text(line.hours)}</span>
                  <span className="text-slate-600 md:text-right">{complimentary ? "—" : `${money(line.hourlyRate)}/hr`}</span>
                  <span className={`font-semibold md:text-right ${complimentary ? "text-emerald-700" : "text-slate-950"}`}>{complimentary ? "No charge" : money(line.lineTotal)}</span>
                </div>
              );
            })}
            {parts.length + labor.length === 0 ? <p className="px-5 py-5 text-sm text-slate-600">No line items were stored in this revision.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Revision integrity</h2>
          <p className="mt-2 text-sm text-slate-600">This identifier verifies the immutable snapshot stored for invoice revision {row.revision}.</p>
          <p className="mt-3 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700" title={row.snapshotSha256}>{row.snapshotSha256}</p>
          <p className="mt-2 text-xs text-slate-500">Short ID: {shortHash(row.snapshotSha256)}</p>
        </section>
      </div>
    </>
  );
}
