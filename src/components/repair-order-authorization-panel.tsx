"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getRepairOrderAuthorizationDefaultsAction, getRepairOrderAuthorizationReadinessAction, hasPendingRemoteRepairOrderAuthorizationAction, getRepairOrderRemoteDeliveryStatusAction, recordVerbalAuthorizationAction, type VerbalAuthorizationActionState } from "@/app/(app)/repair-orders/authorization-actions";
import { getRepairOrderEmailRecipientAction, sendRepairOrderEmailAction } from "@/app/(app)/repair-orders/email-actions";
import type { RepairOrderEmailState } from "@/lib/email/repair-order-email-core";
import { getRepairOrderSmsRecipientAction, sendRepairOrderSmsAuthorizationAction, type SmsAuthorizationState } from "@/app/(app)/repair-orders/sms-actions";
import { formatUsSmsPhone } from "@/lib/messaging/phone";

const initial: VerbalAuthorizationActionState = { status: "idle" };
const initialEmail: RepairOrderEmailState = { status: "idle" };
const initialSms: SmsAuthorizationState = { status: "idle", message: "" };
const REPAIR_ORDER_SAVE_STATE_EVENT = "plumworks:repair-order-save-state";

type AuthorizationStatus = "NOT_AUTHORIZED" | "AUTHORIZED" | "DECLINED" | "DECLINED_PREVIOUS_REVISION";
type EmailDeliveryStatus = string;
type EmailDeliveryState = {
  requestStatus: "PENDING" | "EXPIRED";
  recipientEmail: string | null;
  recipientPhone: string | null;
  channel: "EMAIL" | "SMS";
  sentAt: string | null;
  expiresAt: string;
  deliveryStatus: EmailDeliveryStatus | null;
};

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

function remainingApprovalTime(expiresAt: string, now: number) {
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (remainingMs <= 0) return "expired";
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (remainingMs <= dayMs) {
    const hours = Math.ceil(remainingMs / hourMs);
    return `${hours} ${hours === 1 ? "hour" : "hours"} remaining`;
  }
  const days = Math.ceil(remainingMs / dayMs);
  return `${days} ${days === 1 ? "day" : "days"} remaining`;
}

function failedDelivery(status: EmailDeliveryStatus | null) {
  return status === "bounced" || status === "suppressed" || status === "failed";
}

export function RepairOrderAuthorizationPanel({ repairOrderId, estimatedTotal, summary, history, editable, smsConsentStatus }: {
  repairOrderId: string;
  estimatedTotal: string;
  summary: { status: AuthorizationStatus; approvedRevision: number | null; approvedAt: string | null; authorizerName: string | null };
  history: HistoryItem[];
  editable: boolean;
  smsConsentStatus: "CONSENTED" | "DECLINED" | "OPTED_OUT" | "MISSING";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsRecipient, setSmsRecipient] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [authorizerName, setAuthorizerName] = useState("");
  const [phoneDecision, setPhoneDecision] = useState<"APPROVED" | "DECLINED">("APPROVED");
  const [state, setState] = useState<VerbalAuthorizationActionState>(initial);
  const [saveStateBlocked, setSaveStateBlocked] = useState(false);
  const [revisionReady, setRevisionReady] = useState(false);
  const [readinessChecked, setReadinessChecked] = useState(false);
  const [delivery, setDelivery] = useState<EmailDeliveryState | null>(null);
  const [pendingRemoteAuthorization, setPendingRemoteAuthorization] = useState(false);
  const [deliveryPopup, setDeliveryPopup] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [emailState, emailAction, emailPending] = useActionState(sendRepairOrderEmailAction, initialEmail);
  const [smsState, smsAction, smsPending] = useActionState(sendRepairOrderSmsAuthorizationAction, initialSms);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const shownDeliveryFailure = useRef<string | null>(null);
  const smsReady = smsConsentStatus === "CONSENTED" && process.env.NEXT_PUBLIC_SMS_DEV_UI_ENABLED === "true";
  const authorized = summary.status === "AUTHORIZED";
  const declined = summary.status === "DECLINED";
  const previousDecline = summary.status === "DECLINED_PREVIOUS_REVISION";
  const declineEvidence = history.find((item) => item.decision === "DECLINED") ?? null;
  const saveRequired = !readinessChecked || saveStateBlocked || !revisionReady;
  const waitingForRemoteApproval = !authorized && !declined && (
    pendingRemoteAuthorization || delivery?.requestStatus === "PENDING" ||
    emailState.status === "success" || smsState.status === "success"
  );

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
    if (smsState.status === "success") { setSmsOpen(false); router.refresh(); }
  }, [smsState.status, router]);

  useEffect(() => {
    let active = true;
    let popupTimer: number | undefined;
    const refreshDelivery = async () => {
      const [result, remotePending] = await Promise.all([
        getRepairOrderRemoteDeliveryStatusAction(repairOrderId).catch(() => null),
        hasPendingRemoteRepairOrderAuthorizationAction(repairOrderId).catch(() => false),
      ]);
      if (!active) return;
      setClock(Date.now());
      setDelivery(result as EmailDeliveryState | null);
      setPendingRemoteAuthorization(remotePending);
      if (result && result.channel === "EMAIL" && failedDelivery(result.deliveryStatus)) {
        const key = `${result.recipientEmail ?? "customer"}:${result.deliveryStatus}`;
        if (shownDeliveryFailure.current !== key) {
          shownDeliveryFailure.current = key;
          const message = `Approval email was not delivered to ${result.recipientEmail ?? "the customer"}. Check the email address and resend the approval request.`;
          setDeliveryPopup(message);
          popupTimer = window.setTimeout(() => setDeliveryPopup(null), 9000);
        }
      }
    };
    void refreshDelivery();
    const interval = window.setInterval(refreshDelivery, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
      if (popupTimer) window.clearTimeout(popupTimer);
    };
  }, [repairOrderId, emailState.status, smsState.status]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!waitingForRemoteApproval) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const interval = window.setInterval(refreshIfVisible, 10000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, waitingForRemoteApproval]);

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

  async function openSmsConfirmation() {
    if (saveRequired) return;
    const phone = await getRepairOrderSmsRecipientAction(repairOrderId).catch(() => "");
    setSmsRecipient(formatUsSmsPhone(phone));
    setSmsOpen(true);
  }

  async function openVerbalAuthorization() {
    if (saveRequired) return;
    setState(initial);
    setPhoneDecision("APPROVED");
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
  const deliveryFailure = delivery ? (delivery.channel === "SMS" ? ["failed", "undelivered"].includes(delivery.deliveryStatus ?? "") : failedDelivery(delivery.deliveryStatus)) : false;
  const expiryText = delivery ? remainingApprovalTime(delivery.expiresAt, clock) : null;
  const expiresAtText = delivery ? new Date(delivery.expiresAt).toLocaleString() : null;

  return <section className={`transaction-workspace-width rounded-xl border px-4 py-3 shadow-sm ${tone}`}>
    {deliveryPopup ? <div role="alert" className="fixed right-4 top-4 z-[70] max-w-md rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 shadow-xl">{deliveryPopup}</div> : null}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span aria-hidden="true" className={authorized ? "text-emerald-700" : declined ? "text-red-700" : previousDecline ? "text-orange-700" : "text-amber-700"}>{authorized ? "✓" : declined ? "✕" : previousDecline ? "↺" : "⚠"}</span>
          <strong className={accent}>Customer approval · {authorized ? "Authorized" : declined ? "Estimate declined" : previousDecline ? "Previous estimate declined" : "Not authorized"}</strong>
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
            ? "Repair Order changed after the customer declined. Save draft; the decline remains preserved under View Authorization."
            : "Repair Order changed. Save draft before requesting customer authorization."}</p> : null}
        {!readinessChecked ? <p role="status" className="mt-1 text-xs font-medium text-slate-600">Checking saved Repair Order revision…</p> : null}
        {declined && !saveRequired ? <p className="mt-1 text-xs font-medium text-red-800">The declined estimate remains preserved as evidence. An invoice may still be created for diagnostic or other charges actually due.</p> : null}
        {previousDecline && !saveRequired ? <p className="mt-1 text-xs font-medium text-orange-800">The earlier decline remains preserved as evidence for the prior revision.</p> : null}
        {smsState.status !== "idle" ? <p role={smsState.status === "error" ? "alert" : "status"} className={`mt-1 text-xs font-medium ${smsState.status === "error" ? "text-red-700" : "text-slate-700"}`}>{smsState.message}</p> : null}
        {emailState.status !== "idle" && (emailState.status === "error" || !delivery) ? <p role={emailState.status === "error" ? "alert" : "status"} className={`mt-1 text-xs font-medium ${emailState.status === "error" ? "text-red-700" : "text-slate-600"}`}>{emailState.message}</p> : null}
        {!authorized && !declined && delivery ? delivery.requestStatus === "EXPIRED" || expiryText === "expired"
          ? <p role="status" className="mt-1 text-xs font-bold text-amber-800">Approval link expired. Send a new authorization request.</p>
          : delivery.channel === "SMS"
            ? deliveryFailure
              ? <p role="alert" className="mt-1 text-xs font-bold text-red-700">Estimate text could not be delivered. Check the recipient phone number before sending again.</p>
              : delivery.deliveryStatus === "delivered"
                ? <p role="status" className="mt-1 text-xs font-semibold text-emerald-700">Estimate text delivered{delivery.recipientPhone ? ` to ${formatUsSmsPhone(delivery.recipientPhone)}` : ""}. Awaiting customer authorization. Link expires {expiresAtText} · {expiryText}.</p>
                : <p role="status" className="mt-1 text-xs font-semibold text-slate-700">Estimate text {delivery.deliveryStatus === "sent" ? "sent" : "accepted for delivery"}{delivery.recipientPhone ? ` to ${formatUsSmsPhone(delivery.recipientPhone)}` : ""}. Delivery has not been confirmed yet. Link expires {expiresAtText} · {expiryText}.</p>
            : deliveryFailure
              ? <p role="alert" className="mt-1 text-xs font-bold text-red-700">Approval email was not delivered to {delivery.recipientEmail ?? "the customer"}. Check the email address and resend.</p>
              : delivery.deliveryStatus === "delivery_delayed"
                ? <p role="status" className="mt-1 text-xs font-bold text-amber-800">Approval email delivery is delayed; the email service is retrying. Link expires {expiresAtText} · {expiryText}.</p>
                : delivery.deliveryStatus === "sent" || !delivery.deliveryStatus
                  ? <p role="status" className="mt-1 text-xs font-semibold text-slate-700">Approval email accepted by the email service{delivery.recipientEmail ? ` for ${delivery.recipientEmail}` : ""}. Delivery has not been confirmed yet. Link expires {expiresAtText} · {expiryText}.</p>
                  : <p role="status" className="mt-1 text-xs font-semibold text-emerald-700">Approval email delivered{delivery.recipientEmail ? ` to ${delivery.recipientEmail}` : ""} · Link expires {expiresAtText} · {expiryText}.</p>
          : null}
        {waitingForRemoteApproval && !deliveryFailure ? <p className="mt-1 text-xs font-medium text-slate-600">Waiting for customer decision · this page updates automatically for email or SMS approval links.</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editable && !authorized && !saveRequired && smsReady ? <button type="button" disabled={smsPending} onClick={() => void openSmsConfirmation()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{smsPending ? "Sending…" : waitingForRemoteApproval ? "Resend text" : "Text estimate"}</button> : null}
        {editable && !authorized && !saveRequired && !smsReady ? <button type="button" disabled={emailPending || recipientLoading} onClick={() => void openEmailConfirmation()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><MailIcon />{recipientLoading ? "Loading…" : emailPending ? "Sending…" : "Email approval"}</button> : null}
        {editable && !authorized && saveRequired ? <span className="rounded-full bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900">Save draft before requesting approval</span> : null}
        {editable && !authorized && !saveRequired ? <details className="relative">
          <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-primary">Other methods ▾</summary>
          <div className="absolute right-0 z-20 mt-2 min-w-48 space-y-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            {smsReady ? <button type="button" disabled={emailPending || recipientLoading} onClick={() => void openEmailConfirmation()} className="block min-h-10 w-full rounded px-3 text-left text-sm font-semibold hover:bg-slate-100">Email approval</button> : null}
            {process.env.NEXT_PUBLIC_SMS_DEV_UI_ENABLED === "true" && !smsReady ? <button type="button" onClick={() => void openSmsConfirmation()} className="block min-h-10 w-full rounded px-3 text-left text-sm font-semibold hover:bg-slate-100">Text estimate</button> : null}
            <button type="button" onClick={() => void openVerbalAuthorization()} className="block min-h-10 w-full rounded px-3 text-left text-sm font-semibold hover:bg-slate-100">Record verbal approval</button>
          </div>
        </details> : null}
        {history.length > 0 ? <Link href={`/repair-orders/${repairOrderId}/authorization-evidence`} className={`px-1.5 py-2 text-sm font-semibold underline underline-offset-2 hover:text-brand-primary ${accent}`}>{authorized ? "View approval record" : "View history"}</Link> : null}
      </div>
    </div>

    {smsOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel text estimate" disabled={smsPending} onClick={() => setSmsOpen(false)} className="absolute inset-0 bg-slate-950/50" />
      <section role="dialog" aria-modal="true" aria-labelledby="sms-estimate-title" className="relative w-full max-w-md rounded-2xl border bg-white p-6 text-slate-900 shadow-2xl">
        <h2 id="sms-estimate-title" className="text-xl font-bold">Text Estimate</h2>
        <p className="mt-2 text-sm text-slate-600">Send the repair estimate and secure authorization link to the customer's mobile number.</p>
        <form action={smsAction} className="mt-5 space-y-4">
          <input type="hidden" name="repairOrderId" value={repairOrderId} />
          <input type="hidden" name="testConsent" value="yes" />
          <label className="block text-sm font-semibold">Recipient
            <input type="tel" name="recipientPhone" required readOnly value={smsRecipient} className="mt-1 block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5" />
          </label>
          <p className="text-sm text-slate-600">SMS consent is checked before sending. To change the recipient, edit the customer's phone number.</p>
          {smsState.status === "error" ? <p role="alert" className="text-sm text-red-700">{smsState.message}</p> : null}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setSmsOpen(false)} disabled={smsPending} className="rounded-lg border px-4 py-2">Cancel</button>
            <button type="submit" disabled={smsPending || !smsRecipient.trim()} className="rounded-lg bg-brand-primary px-4 py-2 font-semibold text-white disabled:opacity-50">{smsPending ? "Sending…" : "Send Text"}</button>
          </div>
        </form>
      </section>
    </div> : null}

    {emailOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="Cancel estimate approval email" disabled={emailPending} onClick={() => setEmailOpen(false)} className="absolute inset-0 bg-slate-950/50" /><section role="dialog" aria-modal="true" aria-labelledby="estimate-approval-email-title" className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"><h2 id="estimate-approval-email-title" className="text-xl font-bold text-slate-950">{declined ? "Send estimate approval again" : waitingForRemoteApproval ? "Resend estimate approval" : "Send estimate approval"}</h2><form action={emailAction} onSubmit={() => setEmailOpen(false)} className="mt-5"><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="mode" value="authorization" /><label className="text-sm font-semibold text-slate-700">Send email to</label><input name="recipient" type="email" required maxLength={254} autoComplete="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={emailPending} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10 disabled:opacity-60" />{waitingForRemoteApproval || declined ? <p className="mt-2 text-xs font-medium text-amber-800">Sending a new request will invalidate any previous active approval link. Existing decision evidence remains under View Authorization.</p> : null}{emailState.status === "error" ? <p role="alert" className="mt-2 text-sm font-medium text-red-700">{emailState.message}</p> : null}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={emailPending} onClick={() => setEmailOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button><button type="submit" disabled={emailPending} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{emailPending ? "Sending…" : "Send"}</button></div></form></section></div> : null}

    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="Cancel authorization" disabled={pending} onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/50" /><section role="dialog" aria-modal="true" aria-labelledby="verbal-auth-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h2 id="verbal-auth-title" className="text-xl font-bold text-slate-950">Record Phone Authorization</h2><p className="mt-2 text-sm leading-6 text-slate-600">Record the customer’s phone decision for this exact Repair Order revision. The record is preserved as audit evidence.</p><form action={submit} className="mt-5 space-y-4"><input type="hidden" name="repairOrderId" value={repairOrderId} /><fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold text-slate-800">Customer decision</legend><div className="flex gap-6"><label className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="decision" value="APPROVED" checked={phoneDecision === "APPROVED"} onChange={() => setPhoneDecision("APPROVED")} />Approved</label><label className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="decision" value="DECLINED" checked={phoneDecision === "DECLINED"} onChange={() => setPhoneDecision("DECLINED")} />Declined</label></div></fieldset><label className="block text-sm font-semibold text-slate-800">Person contacted<input name="authorizerName" required minLength={2} maxLength={120} value={authorizerName} onChange={(event) => setAuthorizerName(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-800">Relationship / role <span className="font-normal text-slate-500">(optional)</span><input name="authorizerRelationship" maxLength={120} placeholder="Customer, spouse, fleet manager…" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>{phoneDecision === "APPROVED" ? <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-800">Amount authorized<input name="amountAuthorized" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-800">Total discussed<input name="totalDiscussed" type="number" min="0" step="0.01" required defaultValue={estimatedTotal} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label></div> : null}<label className="block text-sm font-semibold text-slate-800">Notes <span className="font-normal text-slate-500">(optional)</span><textarea name="notes" maxLength={1000} rows={3} placeholder={phoneDecision === "DECLINED" ? "Optional: reason for decline, phone number, or other details" : "Phone number used, special limits, or other verification details"} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>{state.status === "error" ? <p role="alert" className="text-sm font-medium text-red-700">{state.message}</p> : null}<div className="flex justify-end gap-3 pt-2"><button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={pending || saveRequired} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Recording…" : phoneDecision === "DECLINED" ? "Record Decline" : "Record Approval"}</button></div></form></section></div> : null}
  </section>;
}