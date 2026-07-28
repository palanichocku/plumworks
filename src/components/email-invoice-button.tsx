"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { sendInvoiceEmailAction } from "@/app/(app)/invoices/email-actions";
import type { InvoiceEmailState } from "@/lib/email/invoice-email-core";

const initialState: InvoiceEmailState = { status: "idle" };
export const INVOICE_EMAIL_SUCCESS_DURATION_MS = 5_000;
const fallbackError = "Invoice could not be emailed. Please try again.";

export function EmailInvoiceButton({ invoiceId, defaultRecipient, status, printHref }: {
  invoiceId: string;
  defaultRecipient: string;
  status: "Open" | "Closed";
  printHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => setSuccess(null), INVOICE_EMAIL_SUCCESS_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [success]);

  const sent = useCallback((message?: string) => {
    setOpen(false);
    setSuccess(message || "Invoice emailed successfully.");
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  return <div className="flex min-w-0 flex-col items-end gap-1.5">
    <div className="flex flex-wrap items-center justify-end gap-3" data-invoice-action-row>
      <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
        {status}
      </span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { setSuccess(null); setOpen(true); }}
        className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20"
      >
        Email
      </button>
      <Link
        href={printHref}
        className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary"
      >
        Print
      </Link>
    </div>
    {success ? <div aria-live="polite" aria-atomic="true" className="text-right">
      <p role="status" className="text-sm font-medium text-emerald-700">{success}</p>
    </div> : null}
    {open ? <EmailInvoiceDialog invoiceId={invoiceId} defaultRecipient={defaultRecipient} onClose={() => setOpen(false)} onSuccess={sent} /> : null}
  </div>;
}

function EmailInvoiceDialog({ invoiceId, defaultRecipient, onClose, onSuccess }: {
  invoiceId: string;
  defaultRecipient: string;
  onClose: () => void;
  onSuccess: (message?: string) => void;
}) {
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [state, action, pending] = useActionState(sendInvoiceEmailAction, initialState);
  const submittingRef = useRef(false);
  const titleId = useId();
  const errorId = `${titleId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => { if (!pending) onClose(); }, [onClose, pending]);
  const error = state.status === "error" && !errorDismissed ? state.message || fallbackError : null;

  useEffect(() => {
    if (state.status === "success") onSuccess(state.message);
    if (state.status === "error") {
      submittingRef.current = false;
    }
  }, [onSuccess, state]);

  useEffect(() => {
    inputRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; };
  }, [close]);

  if (typeof document === "undefined") return null;

  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
    <button type="button" tabIndex={-1} aria-label="Close Email Invoice dialog" disabled={pending} onClick={close} className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-[1px]" />
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
      <h2 id={titleId} className="text-xl font-bold text-slate-950">Email Invoice</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">A printer-friendly PDF will be attached to the email.</p>
      <form
        action={action}
        onSubmit={(event) => {
          if (submittingRef.current) event.preventDefault();
          else {
            submittingRef.current = true;
            setErrorDismissed(false);
          }
        }}
        className="mt-5"
      >
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <label htmlFor={`${titleId}-recipient`} className="text-sm font-semibold text-slate-700">Recipient email</label>
        <input
          ref={inputRef}
          id={`${titleId}-recipient`}
          name="recipient"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          value={recipient}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => { setRecipient(event.target.value); if (error) setErrorDismissed(true); }}
          disabled={pending}
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10 disabled:opacity-60"
        />
        <div aria-live="assertive" aria-atomic="true" className="mt-2 min-h-5">
          {error ? <p id={errorId} role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" disabled={pending} onClick={close} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-300/40 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={pending} aria-label={pending ? "Sending invoice" : "Send Invoice"} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Sending…" : "Send Invoice"}</button>
        </div>
      </form>
    </section>
  </div>, document.body);
}
