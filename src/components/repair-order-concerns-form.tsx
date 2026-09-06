"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { updateRepairOrderConcerns, type RepairOrderSaveState } from "@/app/(app)/repair-orders/actions";
import { createInvoiceFromRepairOrder, type CreateInvoiceState } from "@/app/(app)/repair-orders/finalize-actions";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";

const initialState: RepairOrderSaveState = { status: "idle" };
const initialCreateState: CreateInvoiceState = { status: "idle" };
const textareaClass = "mt-1.5 min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";

function ConcernsForm({ repairOrderId, customerComplaint, recommendation, action, onChange, onSubmit }: { repairOrderId: string; customerComplaint: string | null; recommendation: string | null; action: (formData: FormData) => void; onChange: () => void; onSubmit: () => void }) {
  return <form id="repair-order-save-form" action={action} onChange={onChange} onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <h2 className="ro-section-heading">Customer Concerns &amp; Recommendations</h2>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <label htmlFor="customerComplaint" className="text-sm font-semibold text-slate-700">Customer Complaint <span className="font-normal text-slate-500">(optional)</span><textarea id="customerComplaint" name="customerComplaint" rows={5} defaultValue={customerComplaint ?? ""} aria-describedby="customerComplaint-help" className={textareaClass} /><span id="customerComplaint-help" className="mt-2 block text-xs font-normal leading-5 text-slate-500">Describe the concern, symptoms, noises, warning lights, or service requested by the customer.</span></label>
      <label htmlFor="recommendation" className="text-sm font-semibold text-slate-700">Service Recommendation <span className="font-normal text-slate-500">(optional)</span><textarea id="recommendation" name="recommendation" rows={5} defaultValue={recommendation ?? ""} aria-describedby="recommendation-help" className={textareaClass} /><span id="recommendation-help" className="mt-2 block text-xs font-normal leading-5 text-slate-500">Record the shop’s inspection findings, recommended repairs, or future service advice.</span></label>
    </div>
  </form>;
}

export function EditableRepairOrderWorkspace({ repairOrderId, customerComplaint, recommendation, overview, parts, labor, totals }: { repairOrderId: string; customerComplaint: string | null; recommendation: string | null; overview: ReactNode; parts: ReactNode; labor: ReactNode; totals: ReactNode }) {
  const [state, action, pending] = useActionState(updateRepairOrderConcerns, initialState);
  const [createState, createAction, creating] = useActionState(createInvoiceFromRepairOrder, initialCreateState);
  const [dirty, setDirty] = useState(false);

  const actions = <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="grid gap-2 sm:grid-cols-2">
      <button form="repair-order-save-form" type="submit" disabled={pending} aria-label="Save Repair Order" className="inline-flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
      <form action={createAction}><input type="hidden" name="repairOrderId" value={repairOrderId} /><button type="submit" disabled={dirty || pending || creating || state.status === "error"} className="inline-flex w-full items-center justify-center rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-50">{creating ? "Creating…" : "Create Invoice"}</button></form>
    </div>
    {dirty ? <p className="mt-3 text-sm font-medium text-amber-700">Save Repair Order changes before creating the Invoice.</p> : null}
    {createState.status === "error" ? <p role="alert" aria-live="assertive" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{createState.message}</p> : null}
    {!dirty && !pending && state.status === "success" ? <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><span aria-hidden="true">✓</span> Repair Order saved.</p> : null}
    {!dirty && !pending && state.status === "error" ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{state.message}</p> : null}
    <p className="mt-3 text-xs leading-5 text-slate-500">After creating the invoice, continue final adjustments and payments on the open invoice. Recording the final payment automatically closes the invoice.</p>
    <Link href="/repair-orders" className="mt-3 inline-flex w-full justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
  </div>;

  return <RepairOrderWorkspace overview={overview} concerns={<ConcernsForm repairOrderId={repairOrderId} customerComplaint={customerComplaint} recommendation={recommendation} action={action} onChange={() => setDirty(true)} onSubmit={() => setDirty(false)} />} parts={parts} labor={labor} totals={totals} notes={null} actions={actions} />;
}
