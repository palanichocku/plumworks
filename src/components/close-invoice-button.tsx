"use client";

import { useState } from "react";
import { closeInvoice } from "@/app/(app)/invoices/lifecycle-actions";
import { FormSubmitButton } from "@/components/form-submit-button";

export function CloseInvoiceButton({ invoiceId, balance }: { invoiceId: string; balance: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-100">Close Invoice</button>
    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="close-invoice-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="close-invoice-title" className="text-xl font-bold text-slate-950">Close this invoice?</h2>
      <p className="mt-3 text-sm text-slate-700">Balance due: <strong>{balance}</strong></p>
      <p className="mt-2 text-sm text-slate-600">Closing is final. Confirm the vehicle has been delivered to the customer.</p>
      <form action={closeInvoice} className="mt-5 space-y-5"><input type="hidden" name="invoiceId" value={invoiceId} /><label className="flex items-start gap-3 text-sm font-semibold text-slate-800"><input required type="checkbox" name="vehicleDelivered" value="yes" className="mt-0.5 size-4" />Vehicle delivered</label><div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button><FormSubmitButton pendingLabel="Closing…" className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Close Invoice</FormSubmitButton></div></form>
    </section></div> : null}
  </>;
}
