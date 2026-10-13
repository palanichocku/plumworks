import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorizationEvidencePrintButton } from "@/components/authorization-evidence-print-button";
import { getRepairOrderAuthorizationEvidence } from "@/lib/authorization/authorization-report";

export const dynamic = "force-dynamic";

function money(value: string | null | undefined) {
  return value == null ? "—" : `$${Number(value).toFixed(2)}`;
}

function methodLabel(method: string) {
  if (method === "PHONE") return "Verbal / Phone";
  if (method === "EMAIL_LINK") return "Secure Email Link";
  if (method === "IN_PERSON_SIGNATURE") return "In-Person Signature";
  return method;
}

export default async function AuthorizationEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getRepairOrderAuthorizationEvidence(id);
  if (!report) notFound();

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link href={`/repair-orders/${id}`} className="text-sm font-semibold text-brand-primary print:hidden">← Repair Order</Link>
        <p className="mt-5 text-sm font-semibold uppercase tracking-wider text-brand-primary">Authorization Evidence</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">RO #{report.order.repairOrderNumber ?? "—"}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">Audit record of customer authorization decisions. Each event is tied to the immutable Repair Order revision and SHA-256 snapshot that existed when the decision was recorded.</p>
      </div>
      <AuthorizationEvidencePrintButton />
    </header>

    {report.records.length === 0 ? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm text-slate-600">No authorization evidence has been recorded for this Repair Order.</p></section> : report.records.map((record) => {
      const snapshot = record.snapshot;
      const vehicle = [snapshot.vehicle?.year, snapshot.vehicle?.make, snapshot.vehicle?.model].filter(Boolean).join(" ");
      return <article key={record.eventId} className="break-inside-avoid rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={record.decision === "APPROVED" ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800" : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800"}>{record.decision}</span>
              <span className="text-sm font-semibold text-slate-900">{methodLabel(record.method)}</span>
              <span className="text-sm text-slate-500">Revision {record.revision}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">Recorded {record.occurredAt.toLocaleString()}</p>
          </div>
          <div className="max-w-md text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Snapshot SHA-256</p>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-700">{record.snapshotSha256}</p>
          </div>
        </div>

        <section className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-base font-bold text-slate-950">Authorization details</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Authorizer</dt><dd className="font-medium text-slate-900">{record.authorizerName}</dd>
              <dt className="text-slate-500">Relationship / role</dt><dd>{record.authorizerRelationship ?? "Not recorded"}</dd>
              <dt className="text-slate-500">Amount authorized</dt><dd>{money(record.amountAuthorized)}</dd>
              <dt className="text-slate-500">Total discussed</dt><dd>{money(record.totalDiscussed)}</dd>
              <dt className="text-slate-500">Method</dt><dd>{methodLabel(record.method)}</dd>
              <dt className="text-slate-500">Decision</dt><dd>{record.decision}</dd>
              {record.staffUserEmail ? <><dt className="text-slate-500">Recorded by staff</dt><dd className="break-all">{record.staffUserEmail}</dd></> : null}
              {record.notes ? <><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-wrap">{record.notes}</dd></> : null}
            </dl>
          </div>

          <div>
            <h2 className="text-base font-bold text-slate-950">Request / electronic evidence</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Recipient email</dt><dd className="break-all">{record.recipientEmail ?? "Not applicable"}</dd>
              <dt className="text-slate-500">Request status</dt><dd>{record.requestStatus ?? "Not applicable"}</dd>
              <dt className="text-slate-500">Sent</dt><dd>{record.sentAt?.toLocaleString() ?? "Not applicable"}</dd>
              <dt className="text-slate-500">Decision time</dt><dd>{record.decidedAt?.toLocaleString() ?? record.occurredAt.toLocaleString()}</dd>
              <dt className="text-slate-500">IP address</dt><dd className="break-all">{record.ipAddress ?? "Not recorded"}</dd>
              <dt className="text-slate-500">User agent</dt><dd className="break-all text-xs">{record.userAgent ?? "Not recorded"}</dd>
              <dt className="text-slate-500">Consent version</dt><dd>{record.consentVersion ?? "Not applicable"}</dd>
            </dl>
            {record.consentText ? <div className="mt-4 rounded-lg bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Consent statement</p><p className="mt-1 text-sm leading-6 text-slate-800">{record.consentText}</p></div> : null}
          </div>
        </section>

        <section className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="text-base font-bold text-slate-950">Authorized Repair Order snapshot</h2>
          <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-slate-500">Customer</p><p className="font-medium text-slate-900">{snapshot.customer?.displayName ?? "—"}</p></div>
            <div><p className="text-slate-500">Vehicle</p><p className="font-medium text-slate-900">{vehicle || "—"}</p></div>
            <div><p className="text-slate-500">VIN</p><p className="break-all font-medium text-slate-900">{snapshot.vehicle?.vin ?? "—"}</p></div>
            <div><p className="text-slate-500">RO total</p><p className="font-bold text-slate-950">{money(snapshot.totals?.total)}</p></div>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Parts</h3>
              {snapshot.parts?.length ? <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200">{snapshot.parts.map((part, index) => <li key={`${part.id ?? index}`} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm"><span>{part.description ?? "Part"}<span className="block text-xs text-slate-500">Qty {part.quantity ?? "—"} × {money(part.unitPrice)}</span></span><span className="font-medium">{money(part.lineTotal)}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No parts.</p>}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Labor</h3>
              {snapshot.labor?.length ? <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200">{snapshot.labor.map((line, index) => <li key={`${line.id ?? index}`} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm"><span>{line.description ?? "Labor"}<span className="block text-xs text-slate-500">{line.complimentary ? "Complimentary" : `${line.hours ?? "—"} hr × ${money(line.hourlyRate)}`}</span></span><span className="font-medium">{money(line.lineTotal)}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No labor.</p>}
            </div>
          </div>

          <dl className="mt-5 ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-sm">
            <dt className="text-slate-500">Parts</dt><dd>{money(snapshot.totals?.parts)}</dd>
            <dt className="text-slate-500">Labor</dt><dd>{money(snapshot.totals?.labor)}</dd>
            <dt className="text-slate-500">Shop supplies</dt><dd>{money(snapshot.totals?.shopSupplies)}</dd>
            <dt className="text-slate-500">Tax</dt><dd>{money(snapshot.totals?.tax)}</dd>
            <dt className="border-t border-slate-200 pt-2 font-bold text-slate-950">Total</dt><dd className="border-t border-slate-200 pt-2 font-bold text-slate-950">{money(snapshot.totals?.total)}</dd>
          </dl>
        </section>
      </article>;
    })}

    <footer className="border-t border-slate-200 pt-4 text-xs text-slate-500">
      This report is generated from immutable authorization events and Repair Order revision snapshots stored by PlumWorks. The SHA-256 value identifies the exact snapshot associated with each authorization decision.
    </footer>
  </div>;
}
