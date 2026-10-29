"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getRepairOrderAuthorizationDefaultsAction, getRepairOrderAuthorizationReadinessAction, recordVerbalAuthorizationAction, type VerbalAuthorizationActionState } from "@/app/(app)/repair-orders/authorization-actions";
import { getRepairOrderEmailRecipientAction, sendRepairOrderEmailAction } from "@/app/(app)/repair-orders/email-actions";
import type { RepairOrderEmailState } from "@/lib/email/repair-order-email-core";

const initial: VerbalAuthorizationActionState = { status: "idle" };
const initialEmail: RepairOrderEmailState = { status: "idle" };
const REPAIR_ORDER_SAVE_STATE_EVENT = "plumworks:repair-order-save-state";

type AuthorizationStatus = "NOT_AUTHORIZED" | "AUTHORIZED" | "DECLINED" | "DECLINED_PREVIOUS_REVISION";

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
  summary: { status: AuthorizationStatus; approvedRevision: number | null; approvedAt: string | null; authorizerName: string | null };
  history: HistoryItem[];
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [authorizerName, setAuthorizerName] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [state, setState] = useState<VerbalAuthorizationActionState>(initial);
  const [saveStateBlocked, setSaveStateBlocked] = useState(false);
  const [revisionReady, setRevisionReady] = useState(false);
  const [readinessChecked, setReadinessChecked] = useState(false);
  const [emailState, emailAction, emailPending] = useActionState(sendRepairOrderEmailAction, initialEmail);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const authorized = summary.status === "AUTHORIZED";
  const declined = summary.status === "DECLINED";
  const previousDecline = summary.status === "DECLINED_PREVIOUS_REVISION";
  const declineEvidence = history.find((item) => item.decision === "DECLINED") ?? null;
  const saveRequired = !readinessChecked || saveStateBlocked || !revisionReady;
  const waitingForEmailApproval = emailState.status === "success" && !authorized && !declined;

  useEffect(() => {
    let active = true;
    const checkReadiness = async () => {
      const ready = await getRepairOrderAuthorizationReadinessAction(repairOrderId).catch(() => false);
      if (!active) return;
      setRevisionReady(ready);
      setReadinessChecked(true);
    };
    void checkReadiness();

    const handleSaveState = (event: Event) => {
      const detail = (event as CustomEvent<RepairOrderSaveStateDetail>).detail;
      if (detail?.repairOrderId !== repairOrderId) return;
      setSaveStateBlocked(detail.blocked);
      if (detail.blocked) {
        setRevisionReady(false);
        setReadinessChecked(true);
      } else {
        void checkReadiness();
      }
    };
    window.addEventListener(REPAIR_ORDER_SAVE_STATE_EVENT, handleSaveState);
    return () => {
      active = false;
      window.removeEventListener(REPAIR_ORDER_SAVE_STATE_EVENT, handleSaveState);
    };
  }, [repairOrderId]);

  useEffect(() => {
    if (emailState.status === "success") setEmailOpen(false);
  }, [emailState.status]);

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

  async function openEmailConfirmation() {
    if (recipientLoading || saveRequired) return;
    setRecipientLoading(true);
    try {
      setRecipient(await getRepairOrderEmailRecipientAction(repairOrderId));
      setEmailOpen(true);
    } finally {
      setRecipientLoading(false);
    }
  }

  async function openVerbalAuthorization() {
    if (saveRequired) return;
    setState(initial);
    const defaults = await getRepairOrderAuthorizationDefaultsAction(repairOrderId).catch(() => ({ authorizerName: "" }));
    setAuthorizerName(defaults.authorizerName);
    setOpen(true);
  }

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

  const tone = authorized
    ? "border-emerald-200 bg-emerald-50/70"
    : declined
      ? "border-red-200 bg-red-50/70"
      : previousDecline
        ? "border-orange-200 bg-orange-50/70"
        : "border-amber-300 bg-amber-50";
  const accent = authorized ? "text-emerald-950" : declined ? "text-red-950" : previousDecline ? "text-orange-950" : "text-amber-950";
  const declineDetail = declineEvidence
    ? `${declineEvidence.authorizerName || "Customer"} on ${new Date(declineEvidence.occurredAt).toLocaleString()}`
    : "customer";

  return <section className={`transaction-workspace-width rounded-xl border px-4 py-3 shadow-sm ${tone}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span aria-hidden="true" className={authorized ? "text-emerald-700" : declined ? "text-red-700" : previousDecline ? "text-orange-700" : "text-amber-700"}>{authorized ? "✓" : declined ? "✕" : previousDecline ? "↺" : "⚠"}</span>
          <strong className={accent}>{authorized ? "Authorized" : declined ? "Estimate declined" : previousDecline ? "Previous estimate declined" : "Authorization required"}</strong>
          <span className={authorized ? "text-emerald-800" : declined ? "text-red-900" : previousDecline ? "text-orange-900" : "text-amber-900"}>· {authorized && summary.approvedAt
            ? `Approved by ${summary.authorizerName ?? "customer"} on ${new Date(summary.approvedAt).toLocaleString()}`
            : declined
              ? `Declined by ${declineDetail}`
              : previousDecline
                ? `Declined by ${declineDetail}; the current Repair Order has changed since that decision`
                : "No approval exists for the current revision"}</span>
        </div>
        {saveRequired && readinessChecked ? <p role="status" className={`mt-1 text-xs font-bold ${declined || previousDecline ? "text-orange-800" : "text-amber-800"}`}>{authorized
          ? "Repair Order changed after approval. Save draft and obtain authorization again."
          : declined
            ? "Repair Order changed after the customer declined. Save draft; the decline remains preserved in Evidence/History."
            : "Repair Order changed. Save draft before requesting customer authorization."}</p> : null}
        {!readinessChecked ? <p role="status" className="mt-1 text-xs font-medium text-slate-600">Checking saved Repair Order revision…</p> : null}
        {declined && !saveRequired ? <p className="mt-1 text-xs font-medium text-red-800">The declined estimate remains preserved as evidence. An invoice may still be created for diagnostic or other charges actually due.</p> : null}
        {previousDecline && !saveRequired ? <p className="mt-1 text-xs font-medium text-orange-800">The earlier decline remains preserved as evidence for the prior revision.</p> : null}
        {emailState.status !== "idle" ? <p role={emailState.status === "error" ? "alert" : "status"} className={`mt-1 text-xs font-medium ${emailState.status === "error" ? "text-red-700" : "text-emerald-700"}`}>{emailState.message}</p> : null}
        {waitingForEmailApproval ? <p className="mt-1 text-xs font-medium text-slate-600">Waiting for customer approval · this page updates automatically.</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {history.length > 0 ? <Link href={`/repair-orders/${repairOrderId}/authorization-evidence`} className={`px-1.5 py-2 text-sm font-semibold underline underline-offset-2 hover:text-brand-primary ${accent}`}>Evidence</Link> : null}
        <button type="button" onClick={() => setShowHistory((value) => !value)} className={`px-1.5 py-2 text-sm font-semibold underline underline-offset-2 hover:text-brand-primary ${accent}`}>{showHistory ? "Hide history" : "History"}</button>
        {editable && !authorized ? <button type="button" disabled={emailPending || recipientLoading || saveRequired} title={saveRequired ? "Save draft before requesting customer authorization." : undefined} onClick={() => void openEmailConfirmation()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"><MailIcon />{recipientLoading ? "Loading…" : emailPending ? "Sending…" : declined ? "Send again" : waitingForEmailApproval ? "Resend" : "Send"}</button> : null}
        {editable && !authorized ? <button type="button" disabled={saveRequired} title={saveRequired ? "Save draft before recording customer authorization." : undefined} onClick={() => void openVerbalAuthorization()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-primary bg-white px-4 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-subtle disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400"><MicIcon />Verbal</button> : null}
      </div>
    </div>

    {showHistory ? <div className="mt-4 border-t border-slate-200 pt-4">{history.length === 0 ? <p className="text-sm text-slate-500">No authorization evidence has been recorded.</p> : <div className="space-y-3">{history.map((item) => <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-900">{item.decision === "APPROVED" ? "Approved" : item.decision === "DECLINED" ? "Declined" : item.decision} · {item.method === "PHONE" ? "Phone" : item.method === "EMAIL_LINK" ? "Email link" : item.method}</strong><span className="text-xs text-slate-500">Revision {item.revision} · {new Date(item.occurredAt).toLocaleString()}</span></div><p className="mt-1 text-slate-700">{item.authorizerName}{item.authorizerRelationship ? ` · ${item.authorizerRelationship}` : ""}</p>{item.decision === "DECLINED" ? <p className="mt-1 text-slate-600">Estimate decision recorded for this revision.</p> : <p className="mt-1 text-slate-600">Authorized: {item.amountAuthorized ? `$${Number(item.amountAuthorized).toFixed(2)}` : "—"} · Total discussed: {item.totalDiscussed ? `$${Number(item.totalDiscussed).toFixed(2)}` : "—"}</p>}{item.staffUserEmail ? <p className="mt-1 text-xs text-slate-500">Recorded by {item.staffUserEmail}</p> : null}{item.notes ? <p className="mt-2 whitespace-pre-wrap text-slate-700">{item.notes}</p> : null}<p className="mt-2 break-all font-mono text-[10px] text-slate-400">Evidence hash: {item.snapshotSha256}</p></article>)}</div>}</div> : null}

    {emailOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="Cancel estimate approval email" disabled={emailPending} onClick={() => setEmailOpen(false)} className="absolute inset-0 bg-slate-950/50" /><section role="dialog" aria-modal="true" aria-labelledby="estimate-approval-email-title" className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"><h2 id="estimate-approval-email-title" className="text-xl font-bold text-slate-950">{declined ? "Send estimate approval again" : waitingForEmailApproval ? "Resend estimate approval" : "Send estimate approval"}</h2><form action={emailAction} onSubmit={() => setEmailOpen(false)} className="mt-5"><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="mode" value="authorization" /><label className="text-sm font-semibold text-slate-700">Send email to</label><input name="recipient" type="email" required maxLength={254} autoComplete="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={emailPending} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10 disabled:opacity-60" />{waitingForEmailApproval || declined ? <p className="mt-2 text-xs font-medium text-amber-800">Sending a new request will invalidate any previous active approval link. Existing decision evidence remains in History.</p> : null}{emailState.status === "error" ? <p role="alert" className="mt-2 text-sm font-medium text-red-700">{emailState.message}</p> : null}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={emailPending} onClick={() => setEmailOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button><button type="submit" disabled={emailPending} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{emailPending ? "Sending…" : "Send"}</button></div></form></section></div> : null}

    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="Cancel authorization" disabled={pending} onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/50" /><section role="dialog" aria-modal="true" aria-labelledby="verbal-auth-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h2 id="verbal-auth-title" className="text-xl font-bold text-slate-950">Record Verbal Authorization</h2><p className="mt-2 text-sm leading-6 text-slate-600">Record exactly who authorized the work and the amount discussed. This creates immutable evidence for the current RO revision.</p><form action={submit} className="mt-5 space-y-4"><input type="hidden" name="repairOrderId" value={repairOrderId} /><label className="block text-sm font-semibold text-slate-800">Authorizing person<input name="authorizerName" required minLength={2} maxLength={120} value={authorizerName} onChange={(event) => setAuthorizerName(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-800">Relationship / role <span className="font-normal text-slate-500">(optional)</span><input name="authorizerRelationship" maxLength={120} placeholder="Customer, spouse, fleet manager…" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-800">Amount authorized<input name="amountAuthorized" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-800">Total discussed<input name="totalDiscussed" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label></div><label className="block text-sm font-semibold text-slate-800">Notes <span className="font-normal text-slate-500">(optional)</span><textarea name="notes" maxLength={1000} rows={3} placeholder="Phone number used, special limits, declined items, or other verification details" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>{state.status === "error" ? <p role="alert" className="text-sm font-medium text-red-700">{state.message}</p> : null}<div className="flex justify-end gap-3 pt-2"><button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={pending || saveRequired} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Recording…" : "Record Authorization"}</button></div></form></section></div> : null}
  </section>;
}
