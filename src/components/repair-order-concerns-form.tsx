"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { type RepairOrderSaveState } from "@/app/(app)/repair-orders/actions";
import { getRepairOrderAuthorizationReadinessAction } from "@/app/(app)/repair-orders/authorization-actions";
import { saveRepairOrderDraftForAuthorization } from "@/app/(app)/repair-orders/save-revision-actions";
import { createInvoiceFromRepairOrder, type CreateInvoiceState } from "@/app/(app)/repair-orders/finalize-actions";
import { DictationButton } from "@/components/dictation-button";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";

const initialState: RepairOrderSaveState = { status: "idle" };
const initialCreateState: CreateInvoiceState = { status: "idle" };
const textareaClass = "mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
const REPAIR_ORDER_SAVE_STATE_EVENT = "plumworks:repair-order-save-state";
const REPAIR_ORDER_NEEDS_SAVE_EVENT = "plumworks:repair-order-needs-save";
type RepairOrderNeedsSaveDetail = { repairOrderId: string };
type ConcernField = "customerComplaint" | "recommendation";

function ConcernsForm({ repairOrderId, customerComplaint, recommendation, action, pending, state, onChange }: {
  repairOrderId: string;
  customerComplaint: string | null;
  recommendation: string | null;
  action: (formData: FormData) => void;
  pending: boolean;
  state: RepairOrderSaveState;
  onChange: () => void;
}) {
  const [savedConcern, setSavedConcern] = useState(customerComplaint ?? "");
  const [savedRecommendation, setSavedRecommendation] = useState(recommendation ?? "");
  const [concernText, setConcernText] = useState(customerComplaint ?? "");
  const [recommendationText, setRecommendationText] = useState(recommendation ?? "");
  const [editing, setEditing] = useState<ConcernField | null>(null);
  const submittedField = useRef<ConcernField | null>(null);

  useEffect(() => {
    if (state.status !== "success" || submittedField.current === null) return;
    const field = submittedField.current;
    submittedField.current = null;
    if (field === "customerComplaint") setSavedConcern(concernText.trim());
    if (field === "recommendation") setSavedRecommendation(recommendationText.trim());
    setEditing(null);
  }, [state, concernText, recommendationText]);

  const cancel = () => {
    setConcernText(savedConcern);
    setRecommendationText(savedRecommendation);
    setEditing(null);
  };

  const startEditing = (field: ConcernField) => {
    setConcernText(savedConcern);
    setRecommendationText(savedRecommendation);
    setEditing(field);
  };

  const fieldHeader = (field: ConcernField, label: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
      {editing !== field ? <button type="button" onClick={() => startEditing(field)} className="rounded-md px-2 py-1 text-xs font-semibold text-brand-primary hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/30">Edit</button> : null}
    </div>
  );

  return <form id="repair-order-save-form" action={action} onSubmit={() => { submittedField.current = editing; }} className="min-w-0">
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <input type="hidden" name="customerComplaint" value={concernText} />
    <input type="hidden" name="recommendation" value={recommendationText} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="check-in-concern-label" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        {fieldHeader("customerComplaint", "Check-in concern")}
        {editing === "customerComplaint" ? <div className="mt-2">
          <div className="flex items-center justify-end"><DictationButton textareaId="customerComplaintEditor" value={concernText} onChange={(next) => { setConcernText(next); onChange(); }} /></div>
          <textarea id="customerComplaintEditor" rows={3} value={concernText} onChange={(event) => { setConcernText(event.target.value); onChange(); }} className={textareaClass} placeholder="Add or update the customer's concern." />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={cancel} disabled={pending} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div> : <p id="check-in-concern-label" className="mt-2 min-h-12 whitespace-pre-wrap text-sm leading-6 text-slate-800">{savedConcern || "No check-in concern recorded."}</p>}
      </section>
      <section aria-labelledby="shop-recommendation-label" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        {fieldHeader("recommendation", "Shop recommendation")}
        {editing === "recommendation" ? <div className="mt-2">
          <div className="flex items-center justify-end"><DictationButton textareaId="recommendationEditor" value={recommendationText} onChange={(next) => { setRecommendationText(next); onChange(); }} /></div>
          <textarea id="recommendationEditor" rows={3} value={recommendationText} onChange={(event) => { setRecommendationText(event.target.value); onChange(); }} className={textareaClass} placeholder="Add findings and recommended work after inspection." />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={cancel} disabled={pending} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div> : <p id="shop-recommendation-label" className="mt-2 min-h-12 whitespace-pre-wrap text-sm leading-6 text-slate-800">{savedRecommendation || "No shop recommendation recorded."}</p>}
      </section>
    </div>
    {state.status === "error" ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{state.message}</p> : null}
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
    <RepairOrderWorkspace overview={overview} concerns={<ConcernsForm repairOrderId={repairOrderId} customerComplaint={customerComplaint} recommendation={recommendation} action={action} pending={pending} state={state} onChange={markDirty} />} parts={parts} labor={labor} totals={totals} notes={notes} actions={actions} />
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
