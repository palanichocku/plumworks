"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sendInvoiceEmailAction } from "@/app/(app)/invoices/email-actions";
import type { InvoiceEmailState } from "@/lib/email/invoice-email-core";

const initialState: InvoiceEmailState = { status: "idle" };

export function EmailInvoiceButton({ invoiceId, defaultRecipient }: { invoiceId: string; defaultRecipient: string }) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [state, action, pending] = useActionState(sendInvoiceEmailAction, initialState);
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => { if (!pending) setOpen(false); }, [pending]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; };
  }, [close, open]);

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary">Email</button>
    {open && typeof document !== "undefined" ? createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <button type="button" tabIndex={-1} aria-label="Close Email Invoice dialog" disabled={pending} onClick={close} className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-[1px]" />
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
        <h2 id={titleId} className="text-xl font-bold text-slate-950">Email Invoice</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">A printer-friendly PDF will be attached to the email.</p>
        <form action={action} className="mt-5">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <label htmlFor={`${titleId}-recipient`} className="text-sm font-semibold text-slate-700">Recipient email</label>
          <input ref={inputRef} id={`${titleId}-recipient`} name="recipient" type="email" required maxLength={254} autoComplete="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={pending} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10 disabled:opacity-60" />
          <div aria-live="polite" aria-atomic="true" className="mt-3 min-h-6">
            {state.status === "success" ? <p role="status" className="text-sm font-medium text-emerald-700">{state.message}</p> : null}
            {state.status === "error" ? <p role="alert" className="text-sm font-medium text-red-700">{state.message}</p> : null}
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" disabled={pending} onClick={close} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Sending…" : "Send Invoice"}</button>
          </div>
        </form>
      </section>
    </div>, document.body) : null}
  </>;
}
