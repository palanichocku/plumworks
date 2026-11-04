"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateInvoiceCategorizedDiscountWithState, type InvoiceEditActionState } from "@/app/(app)/invoices/lifecycle-actions";
type Props = { invoiceId: string; partsDiscountAmount: string | null; laborDiscountAmount: string | null; legacyDiscountAmount: string };
const initial: InvoiceEditActionState = { status: "idle" };
export function InvoiceDiscountForm({ invoiceId, partsDiscountAmount, laborDiscountAmount, legacyDiscountAmount }: Props) {
 const [parts, setParts] = useState(partsDiscountAmount ?? "0.00");
 const [labor, setLabor] = useState(laborDiscountAmount ?? "0.00");
 const [state, action, pending] = useActionState(updateInvoiceCategorizedDiscountWithState, initial);
 const router = useRouter();
 useEffect(() => { if (state.status === "success") router.refresh(); }, [state.status, router]);
 const historical = partsDiscountAmount === null && Number(legacyDiscountAmount) > 0;
 return <form action={action} className="mt-5 space-y-3 border-t border-slate-200 pt-4">
  <input type="hidden" name="invoiceId" value={invoiceId}/>
  <h3 className="text-sm font-semibold text-slate-950">Discounts</h3>
  <p className="text-xs text-slate-600">Choose which charges are discounted. Tax is recalculated for taxable charges. Shop supplies remain unchanged.</p>
  {historical ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Existing proportional discount: ${legacyDiscountAmount}. Saving these fields replaces it; historical discounts are not converted automatically.</p> : null}
  <label className="block text-xs font-semibold text-slate-700">Labor discount ($)<input name="laborDiscountAmount" type="number" min="0" step="0.01" required value={labor} onChange={e=>setLabor(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
  <label className="block text-xs font-semibold text-slate-700">Parts discount ($)<input name="partsDiscountAmount" type="number" min="0" step="0.01" required value={parts} onChange={e=>setParts(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
  <button disabled={pending || (!historical && Number(parts)===Number(partsDiscountAmount??0) && Number(labor)===Number(laborDiscountAmount??0))} className="w-full rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{pending ? "Saving…" : "Save Discounts"}</button>
  {state.status==="success" ? <p role="status" className="text-xs text-emerald-700">Saved.</p>:null}
  {state.status==="error" ? <p role="alert" className="text-xs text-red-700">{state.message}</p>:null}
 </form>;
}
