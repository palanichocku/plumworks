"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { updateRepairOrderConcerns, type RepairOrderSaveState } from "@/app/(app)/repair-orders/actions";
import { getRepairOrderAuthorizationReadinessAction } from "@/app/(app)/repair-orders/authorization-actions";
import { saveRepairOrderDraftForAuthorization } from "@/app/(app)/repair-orders/save-revision-actions";
import { createInvoiceFromRepairOrder, type CreateInvoiceState } from "@/app/(app)/repair-orders/finalize-actions";
import { DictationButton } from "@/components/dictation-button";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";

const initialState: RepairOrderSaveState = { status: "idle" };
const initialCreateState: CreateInvoiceState = { status: "idle" };
const textareaClass = "mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
const REPAIR_ORDER_SAVE_STATE_EVENT = "plumworks:repair-order-save-state";
type ConcernField = "customerComplaint" | "recommendation";
type AuthorizationStatus = "AUTHORIZED" | "NOT_AUTHORIZED" | "DECLINED" | "DECLINED_PREVIOUS_REVISION";

function ConcernsForm({ repairOrderId, customerComplaint, recommendation }: {
  repairOrderId: string;
  customerComplaint: string | null;
  recommendation: string | null;
}) {
  const [state, action, pending] = useActionState(updateRepairOrderConcerns, initialState);
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
          <div className="flex items-center justify-end"><DictationButton textareaId="customerComplaintEditor" value={concernText} onChange={setConcernText} /></div>
          <textarea id="customerComplaintEditor" rows={3} value={concernText} onChange={(event) => setConcernText(event.target.value)} className={textareaClass} placeholder="Add or update the customer's concern." />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={cancel} disabled={pending} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div> : <p id="check-in-concern-label" className="mt-2 min-h-12 whitespace-pre-wrap text-sm leading-6 text-slate-800">{savedConcern || "No check-in concern recorded."}</p>}
      </section>
      <section aria-labelledby="shop-recommendation-label" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        {fieldHeader("recommendation", "Shop recommendation")}
        {editing === "recommendation" ? <div className="mt-2">
          <div className="flex items-center justify-end"><DictationButton textareaId="recommendationEditor" value={recommendationText} onChange={setRecommendationText} /></div>
          <textarea id="recommendationEditor" rows={3} value={recommendationText} onChange={(event) => setRecommendationText(event.target.value)} className={textareaClass} placeholder="Add findings and recommended work after inspection." />
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

export function EditableRepairOrderWorkspace({ repairOrderId, customerComplaint, recommendation, estimatedTotal, overview, parts, labor, totals, notes, authorizationStatus, canOverrideAuthorization }: { repairOrderId: string; customerComplaint: string | null; recommendation: string | null; estimatedTotal: string; overview: ReactNode; parts: ReactNode; labor: ReactNode; totals: ReactNode; notes: ReactNode; authorizationStatus: AuthorizationStatus; canOverrideAuthorization: boolean }) {
  const [state, action, pending] = useActionState(saveRepairOrderDraftForAuthorization, initialState);
  const [createState, createAction, creating] = useActionState(createInvoiceFromRepairOrder, initialCreateState);
  const [revisionReady, setRevisionReady] = useState(false);
  const [readinessChecked, setReadinessChecked] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [postDeclineOpen, setPostDeclineOpen] = useState(false);
  const authorized = authorizationStatus === "AUTHORIZED";
  const declined = authorizationStatus === "DECLINED";
  const previousDecline = authorizationStatus === "DECLINED_PREVIOUS_REVISION";
  const canCreateDirectly = authorized || declined;
  const needsSave = readinessChecked && !revisionReady;
  const invoiceActionDisabled = needsSave || !readinessChecked || pending || creating || state.status === "error";
  const authorizationBlockedUntilSave = needsSave || !readinessChecked || pending || state.status === "error";

  useEffect(() => {
    let active = true;
    const checkReadiness = async () => {
      const ready = await getRepairOrderAuthorizationReadinessAction(repairOrderId).catch(() => false);
      if (!active) return;
      setRevisionReady(ready);
      setReadinessChecked(true);
    };
    void checkReadiness();
    return () => { active = false; };
  }, [repairOrderId, estimatedTotal]);

  useEffect(() => {
    if (state.status !== "success") return;
    setRevisionReady(true);
    setReadinessChecked(true);
  }, [state.status]);

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

  const createTitle = declined
    ? "The customer declined the estimate. You may create an invoice for diagnostic or other charges actually due."
    : !authorized
      ? "Customer authorization is required before invoice creation."
      : undefined;

  const actions = <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="grid gap-2">
      <form action={action}>
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <button type="submit" disabled={pending || !readinessChecked || !needsSave} aria-label="Save financial Repair Order revision" className="inline-flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{pending ? "Saving…" : "Save draft"}</button>
      </form>
      <form action={createAction}>
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <button type="submit" disabled={invoiceActionDisabled || !canCreateDirectly} title={createTitle} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{creating ? "Creating…" : "Create invoice"}</button>
      </form>
    </div>
    {needsSave && readinessChecked ? <p className="mt-3 text-sm font-medium text-amber-700">Repair Order changed. Save draft before requesting authorization or creating the invoice.</p> : null}
    {!readinessChecked ? <p className="mt-3 text-xs font-medium text-slate-500">Checking saved Repair Order revision…</p> : null}
    {declined && !needsSave && readinessChecked ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-800">Customer declined the estimated repair work. Create an invoice only for diagnostic or other charges actually due; final adjustments can be made on the open invoice.</p> : null}
    {previousDecline && canOverrideAuthorization ? <button type="button" disabled={invoiceActionDisabled} onClick={() => setPostDeclineOpen(true)} className="mt-3 text-xs font-semibold text-orange-700 underline underline-offset-2 hover:text-orange-900 disabled:cursor-not-allowed disabled:opacity-50">Create invoice for charges after declined estimate</button> : null}
    {!authorized && !declined && !previousDecline && canOverrideAuthorization ? <button type="button" disabled={invoiceActionDisabled} onClick={() => setOverrideOpen(true)} className="mt-3 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50">Owner/Admin override</button> : null}
    {createState.status === "error" ? <p role="alert" aria-live="assertive" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{createState.message}</p> : null}
    {!needsSave && readinessChecked && !pending && state.status === "success" ? <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><span aria-hidden="true">✓</span> Repair Order saved.</p> : null}
    {!pending && state.status === "error" ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{state.message}</p> : null}
    <p className="mt-3 text-xs leading-5 text-slate-500">Final adjustments and payments happen on the open invoice. Recording the final payment closes it.</p>
    <Link href="/repair-orders" className="mt-3 inline-flex w-full justify-center px-4 py-2 text-sm font-semibold text-slate-700 underline underline-offset-2 hover:text-brand-primary">Cancel</Link>
  </div>;

  return <>
    <RepairOrderWorkspace overview={overview} concerns={<ConcernsForm repairOrderId={repairOrderId} customerComplaint={customerComplaint} recommendation={recommendation} />} parts={parts} labor={labor} totals={totals} notes={notes} actions={actions} />
    {postDeclineOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel post-decline invoice" disabled={creating} onClick={() => setPostDeclineOpen(false)} className="absolute inset-0 bg-slate-950/50" />
      <section role="alertdialog" aria-modal="true" aria-labelledby="post-decline-invoice-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="post-decline-invoice-title" className="text-xl font-bold text-slate-950">Create invoice after declined estimate?</h2>
        <p className="mt-3 rounded-lg bg-orange-50 p-4 text-sm leading-6 text-orange-950">The customer declined an earlier Repair Order revision, and this Repair Order has since changed. The prior decline remains preserved as evidence. Use this path only for diagnostic or other charges actually due.</p>
        <form action={createAction} className="mt-5">
          <input type="hidden" name="repairOrderId" value={repairOrderId} />
          <label className="block text-sm font-semibold text-slate-800">Billing reason
            <textarea name="postDeclineBillingReason" required minLength={10} maxLength={500} rows={4} autoFocus className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Example: Customer declined recommended repairs; invoice is for diagnostic time already performed." />
          </label>
          {createState.status === "error" ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{createState.message}</p> : null}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" disabled={creating} onClick={() => setPostDeclineOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={creating} className="rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50">{creating ? "Creating…" : "Create Invoice"}</button>
          </div>
        </form>
      </section>
    </div> : null}
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
