"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordVerbalAuthorizationAction, type VerbalAuthorizationActionState } from "@/app/(app)/repair-orders/authorization-actions";
import { sendRepairOrderEmailAction } from "@/app/(app)/repair-orders/email-actions";
import type { RepairOrderEmailState } from "@/lib/email/repair-order-email-core";

const initial: VerbalAuthorizationActionState = { status: "idle" };
const initialEmail: RepairOrderEmailState = { status: "idle" };
const REPAIR_ORDER_SAVE_STATE_EVENT = "plumworks:repair-order-save-state";

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

type RepairOrderSaveStateDetail = {
  repairOrderId: string;
  blocked: boolean;
};

function MailIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5v10.5H3.75V6.75Z" /><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 7.5 7.5 5.25L19.5 7.5" /></svg>;
}

function MicIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75a3 3 0 0 0-3 3v5.5a3 3 0 0 0 6 0v-5.5a3 3 0 0 0-3-3Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 11.5v.75a5.25 5.25 0 0 0 10.5 0v-.75M12 17.5v2.75M9.5 20.25h5" /></svg>;
}

export function RepairOrderAuthorizationPanel({ repairOrderId, estimatedTotal, summary, history, editable }: {
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
  const [saveRequired, setSaveRequired] = useState(false);
  const [emailState, emailAction, emailPending] = useActionState(sendRepairOrderEmailAction, initialEmail);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const authorized = summary.status === "AUTHORIZED";
  const waitingForEmailApproval = emailState.status === "success" && !authorized;

  useEffect(() => {
    const handleSaveState = (event: Event) => {
      const detail = (event as CustomEvent<RepairOrderSaveStateDetail>).detail;
      if (detail?.repairOrderId === repairOrderId) setSaveRequired(detail.blocked);
    };
    window.addEventListener(REPAIR_ORDER_SAVE_STATE_EVENT, handleSaveState);
    return () => window.removeEventListener(REPAIR_ORDER_SAVE_STATE_EVENT, handleSaveState);
  }, [repairOrderId]);

  useEffect(() => {
    if (!waitingForEmailApproval) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const interval = window.setInterval(refreshIfVisible, 10000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, waitingForEmailApproval]);

  function submit(formData: FormData) {
    if (submitting.current || saveRequired) return;
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

  return <section className={`rounded-xl border px-4 py-3 shadow-sm ${authorized ? "border-emerald-200 bg-emerald-50/70" : "border-amber-300 bg-amber-50"}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span aria-hidden="true" className={authorized ? "text-emerald-700" : "text-amber-700"}>{authorized ? "✓" : "⚠"}</span>
          <strong className={authorized ? "text-emerald-950" : "text-amber-950"}>{authorized ? "Authorized" : "Authorization required"}</strong>
          <span className={authorized ? "text-emerald-800" : "text-amber-900"}>· {authorized && summary.approvedAt ? `Approved by ${summary.authorizerName ?? "customer"} on ${new Date(summary.approvedAt).toLocaleString()}` : "No approval exists for the current revision"}</span>
        </div>
        {saveRequired ? <p role="status" className="mt-1 text-xs font-bold text-amber-800">{authorized ? "Unsaved RO changes detected. Save draft to recheck authorization." : "Save draft before requesting customer authorization."}</p> : null}
        {emailState.status !== "idle" ? <p role={emailState.status === "error" ? "alert" : "status"} className={`mt-1 text-xs font-medium ${emailState.status === "error" ? "text-red-700" : "text-emerald-700"}`}>{emailState.message}</p> : null}
        {waitingForEmailApproval ? <p className="mt-1 text-xs font-medium text-slate-600">Waiting for customer approval · this page updates automatically.</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {history.length > 0 ? <Link href={`/repair-orders/${repairOrderId}/authorization-evidence`} className="px-1.5 py-2 text-sm font-semibold text-amber-950 underline underline-offset-2 hover:text-brand-primary">Evidence</Link> : null}
        <button type="button" onClick={() => setShowHistory((value) => !value)} className="px-1.5 py-2 text-sm font-semibold text-amber-950 underline underline-offset-2 hover:text-brand-primary">{showHistory ? "Hide history" : "History"}</button>
        {editable && !authorized ? <form action={emailAction}><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="mode" value="authorization" /><button type="submit" disabled={emailPending || saveRequired} title={saveRequired ? "Save draft before requesting customer authorization." : undefined} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><MailIcon />{emailPending ? "Sending…" : "Send"}</button></form> : null}
        {editable && !authorized ? <button type="button" disabled={saveRequired} title={saveRequired ? "Save draft before recording customer authorization." : undefined} onClick={() => { setState(initial); setOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-primary bg-white px-4 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-50"><MicIcon />Verbal</button> : null}
      </div>
    </div>

    {showHistory ? <div className="mt-4 border-t border-amber-200 pt-4">{history.length === 0 ? <p className="text-sm text-slate-500">No authorization evidence has been recorded.</p> : <div className="space-y-3">{history.map((item) => <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-900">{item.decision === "APPROVED" ? "Approved" : item.decision} · {item.method === "PHONE" ? "Phone" : item.method}</strong><span className="text-xs text-slate-500">Revision {item.revision} · {new Date(item.occurredAt).toLocaleString()}</span></div><p className="mt-1 text-slate-700">{item.authorizerName}{item.authorizerRelationship ? ` · ${item.authorizerRelationship}` : ""}</p><p className="mt-1 text-slate-600">Authorized: {item.amountAuthorized ? `$${Number(item.amountAuthorized).toFixed(2)}` : "—"} · Total discussed: {item.totalDiscussed ? `$${Number(item.totalDiscussed).toFixed(2)}` : "—"}</p>{item.staffUserEmail ? <p className="mt-1 text-xs text-slate-500">Recorded by {item.staffUserEmail}</p> : null}{item.notes ? <p className="mt-2 whitespace-pre-wrap text-slate-700">{item.notes}</p> : null}<p className="mt-2 break-all font-mono text-[10px] text-slate-400">Evidence hash: {item.snapshotSha256}</p></article>)}</div>}</div> : null}

    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="Cancel authorization" disabled={pending} onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/50" /><section role="dialog" aria-modal="true" aria-labelledby="verbal-auth-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h2 id="verbal-auth-title" className="text-xl font-bold text-slate-950">Record Verbal Authorization</h2><p className="mt-2 text-sm leading-6 text-slate-600">Record exactly who authorized the work and the amount discussed. This creates immutable evidence for the current RO revision.</p><form action={submit} className="mt-5 space-y-4"><input type="hidden" name="repairOrderId" value={repairOrderId} /><label className="block text-sm font-semibold text-slate-800">Authorizing person<input name="authorizerName" required minLength={2} maxLength={120} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-800">Relationship / role <span className="font-normal text-slate-500">(optional)</span><input name="authorizerRelationship" maxLength={120} placeholder="Customer, spouse, fleet manager…" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-800">Amount authorized<input name="amountAuthorized" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-800">Total discussed<input name="totalDiscussed" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label></div><label className="block text-sm font-semibold text-slate-800">Notes <span className="font-normal text-slate-500">(optional)</span><textarea name="notes" maxLength={1000} rows={3} placeholder="Phone number used, special limits, declined items, or other verification details" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>{state.status === "error" ? <p role="alert" className="text-sm font-medium text-red-700">{state.message}</p> : null}<div className="flex justify-end gap-3 pt-2"><button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={pending || saveRequired} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Recording…" : "Record Authorization"}</button></div></form></section></div> : null}
  </section>;
}
