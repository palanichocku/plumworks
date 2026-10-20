"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { type RepairOrderSaveState } from "@/app/(app)/repair-orders/actions";
import { getRepairOrderAuthorizationReadinessAction } from "@/app/(app)/repair-orders/authorization-actions";
import { saveRepairOrderDraftForAuthorization } from "@/app/(app)/repair-orders/save-revision-actions";
import { createInvoiceFromRepairOrder, type CreateInvoiceState } from "@/app/(app)/repair-orders/finalize-actions";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";

const initialState: RepairOrderSaveState = { status: "idle" };
const initialCreateState: CreateInvoiceState = { status: "idle" };
const textareaClass = "mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
const REPAIR_ORDER_SAVE_STATE_EVENT = "plumworks:repair-order-save-state";
const REPAIR_ORDER_NEEDS_SAVE_EVENT = "plumworks:repair-order-needs-save";

type SpeechRecognitionResultEventLike = { results: ArrayLike<{ 0: { transcript: string } }> };
type SpeechRecognitionErrorEventLike = { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type DictationTarget = "concern" | "recommendation";
type RepairOrderNeedsSaveDetail = { repairOrderId: string };

function ConcernsForm({ repairOrderId, customerComplaint, recommendation, action, onChange, onSubmit }: { repairOrderId: string; customerComplaint: string | null; recommendation: string | null; action: (formData: FormData) => void; onChange: () => void; onSubmit: () => void }) {
  const [concernText, setConcernText] = useState(customerComplaint ?? "");
  const [recommendationText, setRecommendationText] = useState(recommendation ?? "");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechListening, setSpeechListening] = useState<DictationTarget | null>(null);
  const [speechError, setSpeechError] = useState<{ target: DictationTarget; message: string } | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);

  function startVoiceDictation(target: DictationTarget) {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognitionRef.current?.stop();
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      if (target === "concern") {
        setConcernText((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript);
      } else {
        setRecommendationText((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript);
      }
      onChange();
    };
    recognition.onerror = (event) => {
      setSpeechError({
        target,
        message: event.error === "not-allowed" ? "Microphone access was not allowed." : "Voice dictation could not start. You can keep typing instead.",
      });
      setSpeechListening(null);
    };
    recognition.onend = () => {
      setSpeechListening(null);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setSpeechError(null);
    setSpeechListening(target);
    try {
      recognition.start();
    } catch {
      setSpeechListening(null);
      recognitionRef.current = null;
      setSpeechError({ target, message: "Voice dictation could not start. You can keep typing instead." });
    }
  }

  function stopVoiceDictation() {
    recognitionRef.current?.stop();
  }

  return <form id="repair-order-save-form" action={action} onChange={onChange} onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="check-in-concern-label">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label id="check-in-concern-label" htmlFor="customerComplaint" className="text-sm font-semibold text-slate-700">Check-in concern</label>
          {speechSupported ? <button type="button" onClick={speechListening === "concern" ? stopVoiceDictation : () => startVoiceDictation("concern")} disabled={speechListening !== null && speechListening !== "concern"} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-primary hover:border-brand-primary hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-50" aria-pressed={speechListening === "concern"}>
            <span aria-hidden="true">🎤</span>{speechListening === "concern" ? "Stop listening" : "Speak"}
          </button> : null}
        </div>
        <textarea id="customerComplaint" name="customerComplaint" rows={3} value={concernText} onChange={(event) => setConcernText(event.target.value)} className={textareaClass} placeholder="Add or update the customer's concern." />
        <p className="mt-1.5 text-xs text-slate-500">Originally captured during vehicle check-in. New typing or dictation is added to the same concern.</p>
        {speechError?.target === "concern" ? <p role="alert" className="mt-1.5 text-xs font-medium text-amber-700">{speechError.message}</p> : null}
      </section>
      <section aria-labelledby="shop-recommendation-label">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label id="shop-recommendation-label" htmlFor="recommendation" className="text-sm font-semibold text-slate-700">Shop recommendation</label>
          {speechSupported ? <button type="button" onClick={speechListening === "recommendation" ? stopVoiceDictation : () => startVoiceDictation("recommendation")} disabled={speechListening !== null && speechListening !== "recommendation"} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-primary hover:border-brand-primary hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-50" aria-pressed={speechListening === "recommendation"}>
            <span aria-hidden="true">🎤</span>{speechListening === "recommendation" ? "Stop listening" : "Speak"}
          </button> : null}
        </div>
        <textarea id="recommendation" name="recommendation" rows={3} value={recommendationText} onChange={(event) => setRecommendationText(event.target.value)} className={textareaClass} placeholder="Add findings and recommended work after inspection." />
        {speechSupported ? <p className="mt-1.5 text-xs text-slate-500">Voice dictation is optional and uses your browser's built-in speech recognition when available.</p> : null}
        {speechError?.target === "recommendation" ? <p role="alert" className="mt-1.5 text-xs font-medium text-amber-700">{speechError.message}</p> : null}
      </section>
    </div>
  </form>;
}

export function EditableRepairOrderWorkspace({ repairOrderId, customerComplaint, recommendation, overview, parts, labor, totals, notes, authorizationStatus, canOverrideAuthorization }: { repairOrderId: string; customerComplaint: string | null; recommendation: string | null; overview: ReactNode; parts: ReactNode; labor: ReactNode; totals: ReactNode; notes: ReactNode; authorizationStatus: "AUTHORIZED" | "NOT_AUTHORIZED"; canOverrideAuthorization: boolean }) {
  const [state, action, pending] = useActionState(saveRepairOrderDraftForAuthorization, initialState);
  const [createState, createAction, creating] = useActionState(createInvoiceFromRepairOrder, initialCreateState);
  const [dirty, setDirty] = useState(false);
  const [revisionReady, setRevisionReady] = useState(false);
  const [readinessChecked, setReadinessChecked] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const storageKey = `plumworks:repair-order-needs-save:${repairOrderId}`;
  const authorized = authorizationStatus === "AUTHORIZED";
  const needsSave = dirty || (readinessChecked && !revisionReady);
  const invoiceActionDisabled = needsSave || !readinessChecked || pending || creating || state.status === "error";
  const authorizationBlockedUntilSave = needsSave || !readinessChecked || pending || state.status === "error";

  const markDirty = () => {
    setDirty(true);
    setRevisionReady(false);
    setReadinessChecked(true);
    try { window.sessionStorage.setItem(storageKey, "1"); } catch { /* ignore storage restrictions */ }
  };

  useEffect(() => {
    let active = true;
    const checkReadiness = async () => {
      const ready = await getRepairOrderAuthorizationReadinessAction(repairOrderId).catch(() => false);
      if (!active) return;
      setRevisionReady(ready);
      setReadinessChecked(true);
    };
    void checkReadiness();

    try {
      if (window.sessionStorage.getItem(storageKey) === "1") markDirty();
    } catch { /* ignore storage restrictions */ }

    const handleNeedsSave = (event: Event) => {
      const detail = (event as CustomEvent<RepairOrderNeedsSaveDetail>).detail;
      if (detail?.repairOrderId === repairOrderId) markDirty();
    };
    window.addEventListener(REPAIR_ORDER_NEEDS_SAVE_EVENT, handleNeedsSave);
    return () => {
      active = false;
      window.removeEventListener(REPAIR_ORDER_NEEDS_SAVE_EVENT, handleNeedsSave);
    };
  }, [repairOrderId, storageKey]);

  useEffect(() => {
    if (state.status !== "success") return;
    setDirty(false);
    setRevisionReady(true);
    setReadinessChecked(true);
    try { window.sessionStorage.removeItem(storageKey); } catch { /* ignore storage restrictions */ }
  }, [state.status, storageKey]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(REPAIR_ORDER_SAVE_STATE_EVENT, {
      detail: { repairOrderId, blocked: authorizationBlockedUntilSave },
    }));
  }, [repairOrderId, authorizationBlockedUntilSave]);

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent(REPAIR_ORDER_SAVE_STATE_EVENT, {
      detail: { repairOrderId, blocked: false },
    }));
  }, [repairOrderId]);

  const actions = <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="grid gap-2">
      <button form="repair-order-save-form" type="submit" disabled={pending || !readinessChecked || !needsSave} aria-label="Save Repair Order" className="inline-flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{pending ? "Saving…" : "Save draft"}</button>
      <form action={createAction}>
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <button type="submit" disabled={invoiceActionDisabled || !authorized} title={!authorized ? "Customer authorization is required before invoice creation." : undefined} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{creating ? "Creating…" : "Create invoice"}</button>
      </form>
    </div>
    {needsSave && readinessChecked ? <p className="mt-3 text-sm font-medium text-amber-700">Repair Order changed. Save draft before requesting authorization or creating the invoice.</p> : null}
    {!readinessChecked ? <p className="mt-3 text-xs font-medium text-slate-500">Checking saved Repair Order revision…</p> : null}
    {!authorized ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      <p className="font-semibold">Needs customer authorization</p>
      <p className="mt-1 text-xs leading-5">{needsSave || !readinessChecked ? "Save the Repair Order first. Send and Verbal remain unavailable until the save completes." : "Use Send or Verbal in the authorization banner above before creating an invoice."}</p>
      {canOverrideAuthorization ? <button type="button" disabled={invoiceActionDisabled} onClick={() => setOverrideOpen(true)} className="mt-2 text-xs font-bold text-amber-900 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Owner/Admin override</button> : null}
    </div> : null}
    {createState.status === "error" ? <p role="alert" aria-live="assertive" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{createState.message}</p> : null}
    {!needsSave && readinessChecked && !pending && state.status === "success" ? <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><span aria-hidden="true">✓</span> Repair Order saved. Customer authorization can now be requested.</p> : null}
    {!pending && state.status === "error" ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{state.message}</p> : null}
    <p className="mt-3 text-xs leading-5 text-slate-500">Final adjustments and payments happen on the open invoice. Recording the final payment closes it.</p>
    <Link href="/repair-orders" className="mt-3 inline-flex w-full justify-center px-4 py-2 text-sm font-semibold text-slate-700 underline underline-offset-2 hover:text-brand-primary">Cancel</Link>
  </div>;

  return <>
    <RepairOrderWorkspace overview={overview} concerns={<ConcernsForm repairOrderId={repairOrderId} customerComplaint={customerComplaint} recommendation={recommendation} action={action} onChange={markDirty} onSubmit={() => undefined} />} parts={parts} labor={labor} totals={totals} notes={notes} actions={actions} />
    {overrideOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel authorization override" disabled={creating} onClick={() => setOverrideOpen(false)} className="absolute inset-0 bg-slate-950/50" />
      <section role="alertdialog" aria-modal="true" aria-labelledby="authorization-override-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="authorization-override-title" className="text-xl font-bold text-slate-950">Create Invoice without current customer authorization?</h2>
        <p className="mt-3 rounded-lg bg-amber-50 p-4 text-sm leading-6 text-amber-950">This is an Owner/Admin exception. Your identity, timestamp, current Repair Order evidence hash, and the reason below will be retained in the audit trail.</p>
        <form action={createAction} className="mt-5">
          <input type="hidden" name="repairOrderId" value={repairOrderId} />
          <label className="block text-sm font-semibold text-slate-800">Override reason
            <textarea name="authorizationOverrideReason" required minLength={10} maxLength={500} rows={4} autoFocus className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Explain why the invoice must be created without current customer authorization." />
          </label>
          {createState.status === "error" ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{createState.message}</p> : null}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" disabled={creating} onClick={() => setOverrideOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={creating} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">{creating ? "Creating…" : "Override & Create Invoice"}</button>
          </div>
        </form>
      </section>
    </div> : null}
  </>;
}
