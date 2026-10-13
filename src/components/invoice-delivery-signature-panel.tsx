import Link from "next/link";

function shortHash(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-12)}` : value;
}

type SignatureRecord = {
  eventId: string;
  sessionId: string;
  role: "CUSTOMER" | "SHOP_REPRESENTATIVE";
  signerName: string;
  occurredAt: string;
  staffUserEmail: string | null;
  signatureData: string;
  signatureSha256: string;
  revision: number;
  snapshotSha256: string;
};

export function InvoiceDeliverySignaturePanel({
  invoiceId,
  currentComplete,
  signatures,
}: {
  invoiceId: string;
  invoiceNumber: string;
  vehicleLabel: string;
  totalLabel: string;
  defaultCustomerName: string;
  currentComplete: boolean;
  signatures: SignatureRecord[];
}) {
  const sessions = Array.from(new Set(signatures.map((row) => row.sessionId))).map((sessionId) => ({
    sessionId,
    rows: signatures.filter((row) => row.sessionId === sessionId),
  }));

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Vehicle Delivery Signatures</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={
                currentComplete
                  ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800"
                  : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800"
              }
            >
              {currentComplete ? "Customer + shop signatures on file" : "Signatures not yet captured"}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Two immutable signatures are retained with the exact invoice revision: the customer and the shop representative who completes delivery.
          </p>
        </div>

        {!currentComplete ? (
          <Link
            href={`/invoices/${invoiceId}/delivery-signatures`}
            className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white"
          >
            Capture Delivery Signatures
          </Link>
        ) : null}
      </div>

      {sessions.length ? (
        <div className="mt-5 space-y-4 border-t border-slate-200 pt-5">
          {sessions.map((session) => {
            const revision = session.rows[0]?.revision;
            const snapshotHash = session.rows[0]?.snapshotSha256;
            return (
              <article key={session.sessionId} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">Delivery signature set · Invoice revision {revision}</p>
                  <p className="font-mono text-[10px] text-slate-500" title={snapshotHash}>
                    Integrity ID {snapshotHash ? shortHash(snapshotHash) : "—"}
                  </p>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {session.rows.map((row) => (
                    <div key={row.eventId} className="rounded-lg bg-slate-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {row.role === "CUSTOMER" ? "Customer" : "Shop Representative"}
                      </p>
                      <p className="mt-1 font-semibold text-slate-950">{row.signerName}</p>
                      <img
                        src={row.signatureData}
                        alt={`${row.signerName} signature`}
                        className="mt-3 h-28 w-full rounded-lg border border-slate-200 bg-white object-contain"
                      />
                      <p className="mt-2 text-xs text-slate-500">Signed {new Date(row.occurredAt).toLocaleString()}</p>
                      {row.staffUserEmail ? (
                        <p className="mt-1 break-all text-xs text-slate-500">Recorded by {row.staffUserEmail}</p>
                      ) : null}
                      <p className="mt-1 font-mono text-[10px] text-slate-400" title={row.signatureSha256}>
                        Signature ID {shortHash(row.signatureSha256)}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
