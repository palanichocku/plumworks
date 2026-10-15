"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { updateRepairOrderConcerns, type RepairOrderSaveState } from "@/app/(app)/repair-orders/actions";
import { createInvoiceFromRepairOrder, type CreateInvoiceState } from "@/app/(app)/repair-orders/finalize-actions";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";

const initialState: RepairOrderSaveState = { status: "idle" };
const initialCreateState: CreateInvoiceState = { status: "idle" };
const textareaClass = "mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";

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

function ConcernsForm({ repairOrderId, customerComplaint, recommendation, action, onChange, onSubmit }: { repairOrderId: string; customerComplaint: string | null; recommendation: string | null; action: (formData: FormData) => void; onChange: () => void; onSubmit: () => void }) {
  const [recommendationText, setRecommendationText] = useState(recommendation ?? "");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);

  function startVoiceDictation() {
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
      setRecommendationText((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript);
      onChange();
    };
    recognition.onerror = (event) => {
      setSpeechError(event.error === "not-allowed" ? "Microphone access was not allowed." : "Voice dictation could not start. You can keep typing instead.");
      setSpeechListening(false);
    };
    recognition.onend = () => {
      setSpeechListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setSpeechError(null);
    setSpeechListening(true);
    try {
      recognition.start();
    } catch {
      setSpeechListening(false);
      recognitionRef.current = null;
      setSpeechError("Voice dictation could not start. You can keep typing instead.");
    }
  }

  function stopVoiceDictation() {
    recognitionRef.current?.stop();
  }

  return <form id="repair-order-save-form" action={action} onChange={onChange} onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <input type="hidden" name="customerComplaint" value={customerComplaint ?? ""} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="check-in-concern-label">
        <h3 id="check-in-concern-label" className="text-sm font-semibold text-slate-700">Check-in concern</h3>
        <div className="mt-1.5 min-h-20 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-800">
          {customerComplaint?.trim() ? customerComplaint : <span className="text-slate-400">No customer concern was recorded at check-in.</span>}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Captured during vehicle check-in.</p>
      </section>
      <section aria-labelledby="shop-recommendation-label">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label id="shop-recommendation-label" htmlFor="recommendation" className="text-sm font-semibold text-slate-700">Shop recommendation</label>
          {speechSupported ? <button type="button" onClick={speechListening ? stopVoiceDictation : startVoiceDictation} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-primary hover:border-brand-primary hover:bg-brand-subtle" aria-pressed={speechListening}>
            <span aria-hidden="true">🎤</span>{speechListening ? "Stop listening" : "Speak"}
          </button> : null}
        </div>
        <textarea id="recommendation" name="recommendation" rows={3} value={recommendationText} onChange={(event) => setRecommendationText(event.target.value)} className={textareaClass} placeholder="Add findings and recommended work after inspection." />
        {speechSupported ? <p className="mt-1.5 text-xs text-slate-500">Voice dictation is optional and uses your browser's built-in speech recognition when available.</p> : null}
        {speechError ? <p role="alert" className="mt-1.5 text-xs font-medium text-amber-700">{speechError}</p> : null}
      </section>
    </div>
  </form>;
}

export function EditableRepairOrderWorkspace({ repairOrderId, customerComplaint, recommendation, overview, parts, labor, totals, notes, authorizationStatus, canOverrideAuthorization }: { repairOrderId: string; customerComplaint: string | null; recommendation: string | null; overview: ReactNode; parts: ReactNode; labor: ReactNode; totals: ReactNode; notes: ReactNode; authorizationStatus: "AUTHORIZED" | "NOT_AUTHORIZED"; canOverrideAuthorization: boolean }) {
  const [state, action, pending] = useActionState(updateRepairOrderConcerns, initialState);
  const [createState, createAction, creating] = useActionState(createInvoiceFromRepairOrder, initialCreateState);
  const [dirty, setDirty] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const authorized = authorizationStatus === "AUTHORIZED";
  const invoiceActionDisabled = dirty || pending || creating || state.status === "error";

  const actions = <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="grid gap-2">
      <button form="repair-order-save-form" type="submit" disabled={pending} aria-label="Save Repair Order" className="inline-flex w-full items-center justify-center rounded-lg border border-slate-400 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Saving…" : "Save draft"}</button>
      <form action={createAction}>
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <button type="submit" disabled={invoiceActionDisabled || !authorized} title={!authorized ? "Customer authorization is required before invoice creation." : undefined} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{creating ? "Creating…" : "Create invoice"}</button>
      </form>
    </div>
    {dirty ? <p className="mt-3 text-sm font-medium text-amber-700">Save draft changes before creating the invoice.</p> : null}
    {!authorized ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      <p className="font-semibold">Needs customer authorization</p>
      <p className="mt-1 text-xs leading-5">Use Send or Verbal in the authorization banner above before creating an invoice.</p>
      {canOverrideAuthorization ? <button type="button" disabled={invoiceActionDisabled} onClick={() => setOverrideOpen(true)} className="mt-2 text-xs font-bold text-amber-900 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Owner/Admin override</button> : null}
    </div> : null}
    {createState.status === "error" ? <p role="alert" aria-live="assertive" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{createState.message}</p> : null}
    {!dirty && !pending && state.status === "success" ? <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><span aria-hidden="true">✓</span> Repair Order saved.</p> : null}
    {!dirty && !pending && state.status === "error" ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{state.message}</p> : null}
    <p className="mt-3 text-xs leading-5 text-slate-500">Final adjustments and payments happen on the open invoice. Recording the final payment closes it.</p>
    <Link href="/repair-orders" className="mt-3 inline-flex w-full justify-center px-4 py-2 text-sm font-semibold text-slate-700 underline underline-offset-2 hover:text-brand-primary">Cancel</Link>
  </div>;

  return <>
    <RepairOrderWorkspace overview={overview} concerns={<ConcernsForm repairOrderId={repairOrderId} customerComplaint={customerComplaint} recommendation={recommendation} action={action} onChange={() => setDirty(true)} onSubmit={() => setDirty(false)} />} parts={parts} labor={labor} totals={totals} notes={notes} actions={actions} />
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
