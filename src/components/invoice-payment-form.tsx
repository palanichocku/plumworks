"use client";

import { useActionState } from "react";
import { recordPaymentWithState, type PaymentActionState } from "@/app/(app)/invoices/payment-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_PAYER_LABELS, PAYMENT_PAYER_TYPES } from "@/lib/payment-options";

const initialState: PaymentActionState = { status: "idle" };
const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal";

export function InvoicePaymentForm({ invoiceId, remainingBalance, paymentDate }: { invoiceId: string; remainingBalance: string; paymentDate: string }) {
  const [state, action] = useActionState(recordPaymentWithState, initialState);
  return <form action={action} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 sm:items-end">
    <input type="hidden" name="invoiceId" value={invoiceId} />
    <label className="text-sm font-semibold text-slate-700">Amount<input name="amount" type="number" required min="0.01" max={remainingBalance} step="0.01" defaultValue={remainingBalance} className={inputClass} /></label>
    <label className="text-sm font-semibold text-slate-700">Payer<select name="payerType" required defaultValue="CUSTOMER" className={inputClass}>{PAYMENT_PAYER_TYPES.map((payer) => <option key={payer} value={payer}>{PAYMENT_PAYER_LABELS[payer]}</option>)}</select></label>
    <label className="text-sm font-semibold text-slate-700">Method<select name="method" required defaultValue="card" className={inputClass}>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}</select></label>
    <label className="text-sm font-semibold text-slate-700">Payment date<input name="paymentDate" type="date" required defaultValue={paymentDate} className={inputClass} /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-1">Reference <span className="font-normal text-slate-500">(optional)</span><input name="reference" maxLength={100} placeholder="Check or authorization number" className={inputClass} /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-1">Note <span className="font-normal text-slate-500">(optional)</span><textarea name="note" maxLength={500} rows={2} className={inputClass} /></label>
    <div className="sm:col-span-2 sm:flex sm:justify-end"><FormSubmitButton pendingLabel="Recording…" confirmTitle="Record this payment?" confirmDescription="Verify the payer, amount, payment method, and date before continuing. This payment cannot be edited or deleted yet." confirmLabel="Record payment" className="w-full rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary disabled:opacity-50 sm:w-auto">Record payment</FormSubmitButton></div>
    {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`sm:col-span-2 rounded-lg px-3 py-2 text-sm ${state.status === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{state.message}</p> : null}
  </form>;
}
