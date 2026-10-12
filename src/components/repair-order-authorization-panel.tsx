"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordVerbalAuthorizationAction, type VerbalAuthorizationActionState } from "@/app/(app)/repair-orders/authorization-actions";

const initial: VerbalAuthorizationActionState = { status: "idle" };

type HistoryItem = {
  id: string;
  revision: number;
  method: string;
  decision: string;
  authorizerName: string;
  authorizerRelationship: string | null;
  amountAuthorized: string | null;
  totalDiscussed: string | null;
  notes: string | null;
  staffUserEmail: string | null;
  occurredAt: string;
  snapshotSha256: string;
};

export function RepairOrderAuthorizationPanel({
  repairOrderId,
  estimatedTotal,
  summary,
  history,
  editable,
}: {
  repairOrderId: string;
  estimatedTotal: string;
  summary: { status: "NOT_AUTHORIZED" | "AUTHORIZED"; approvedRevision: number | null; approvedAt: string | null; authorizerName: string | null };
  history: HistoryItem[];
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [state, setState] = useState<VerbalAuthorizationActionState>(initial);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);

  function submit(formData: FormData) {
    if (submitting.current) return;
    submitting.current = true;
    startTransition(async () => {
      const result = await recordVerbalAuthorizationAction(initial, formData);
      setState(result);
      submitting.current = false;
      if (result.status === "success") {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="ro-section-heading">Customer Authorization</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={summary.status === "AUTHORIZED" ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800" : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800"}>
            {summary.status === "AUTHORIZED" ? "Authorized" : "Authorization required"}
          </span>
          {summary.status === "AUTHORIZED" && summary.approvedRevision ? <span className="text-xs text-slate-500">Revision {summary.approvedRevision}</span> : null}
        </div>
        {summary.status === "AUTHORIZED" && summary.approvedAt ? <p className="mt-2 text-sm text-slate-600">Approved by {summary.authorizerName ?? "customer"} on {new Date(summary.approvedAt).toLocaleString()}.</p> : <p className="mt-2 text-sm text-slate-600">No approval exists for the current RO revision.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowHistory((value) => !value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{showHistory ? "Hide History" : "Authorization History"}</button>
        {editable ? <button type="button" onClick={() => { setState(initial); setOpen(true); }} className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary">Record Verbal Authorization</button> : null}
      </div>
    </div>

    {showHistory ? <div className="mt-4 border-t border-slate-200 pt-4">
      {history.length === 0 ? <p className="text-sm text-slate-500">No authorization evidence has been recorded.</p> : <div className="space-y-3">{history.map((item) => <article key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-900">{item.decision === "APPROVED" ? "Approved" : item.decision} · {item.method === "PHONE" ? "Phone" : item.method}</strong><span className="text-xs text-slate-500">Revision {item.revision} · {new Date(item.occurredAt).toLocaleString()}</span></div>
        <p className="mt-1 text-slate-700">{item.authorizerName}{item.authorizerRelationship ? ` · ${item.authorizerRelationship}` : ""}</p>
        <p className="mt-1 text-slate-600">Authorized: {item.amountAuthorized ? `$${Number(item.amountAuthorized).toFixed(2)}` : "—"} · Total discussed: {item.totalDiscussed ? `$${Number(item.totalDiscussed).toFixed(2)}` : "—"}</p>
        {item.staffUserEmail ? <p className="mt-1 text-xs text-slate-500">Recorded by {item.staffUserEmail}</p> : null}
        {item.notes ? <p className="mt-2 whitespace-pre-wrap text-slate-700">{item.notes}</p> : null}
        <p className="mt-2 break-all font-mono text-[10px] text-slate-400">Evidence hash: {item.snapshotSha256}</p>
      </article>)}</div>}
    </div> : null}

    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel authorization" disabled={pending} onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/50" />
      <section role="dialog" aria-modal="true" aria-labelledby="verbal-auth-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="verbal-auth-title" className="text-xl font-bold text-slate-950">Record Verbal Authorization</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Record exactly who authorized the work and the amount discussed. This creates immutable evidence for the current RO revision.</p>
        <form action={submit} className="mt-5 space-y-4">
          <input type="hidden" name="repairOrderId" value={repairOrderId} />
          <label className="block text-sm font-semibold text-slate-800">Authorizing person<input name="authorizerName" required minLength={2} maxLength={120} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
          <label className="block text-sm font-semibold text-slate-800">Relationship / role <span className="font-normal text-slate-500">(optional)</span><input name="authorizerRelationship" maxLength={120} placeholder="Customer, spouse, fleet manager…" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-800">Amount authorized<input name="amountAuthorized" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
            <label className="block text-sm font-semibold text-slate-800">Total discussed<input name="totalDiscussed" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
          </div>
          <label className="block text-sm font-semibold text-slate-800">Notes <span className="font-normal text-slate-500">(optional)</span><textarea name="notes" maxLength={1000} rows={3} placeholder="Phone number used, special limits, declined items, or other verification details" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
          {state.status === "error" ? <p role="alert" className="text-sm font-medium text-red-700">{state.message}</p> : null}
          <div className="flex justify-end gap-3 pt-2"><button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={pending} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Recording…" : "Record Authorization"}</button></div>
        </form>
      </section>
    </div> : null}
  </section>;
}
