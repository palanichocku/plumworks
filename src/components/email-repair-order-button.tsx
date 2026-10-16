"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { sendRepairOrderEmailAction } from "@/app/(app)/repair-orders/email-actions";
import type { RepairOrderEmailState } from "@/lib/email/repair-order-email-core";

const initialState: RepairOrderEmailState = { status: "idle" };
export const REPAIR_ORDER_EMAIL_SUCCESS_DURATION_MS = 5_000;
const fallbackError = "Estimate could not be emailed. Please try again.";

function MailIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5v10.5H3.75V6.75Z" /><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 7.5 7.5 5.25L19.5 7.5" /></svg>;
}

export function EmailRepairOrderButton({ repairOrderId, defaultRecipient, status, printHref }: {
  repairOrderId: string;
  defaultRecipient: string;
  status: string;
  printHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => setSuccess(null), REPAIR_ORDER_EMAIL_SUCCESS_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [success]);

  const sent = useCallback((message?: string) => {
    setOpen(false);
    setSuccess(message || "Estimate emailed successfully.");
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  return <div className="flex min-w-0 flex-col items-end gap-1.5">
    <div className="flex flex-wrap items-center justify-end gap-2" data-repair-order-action-row>
      {status !== "void" ? <button
        ref={buttonRef}
        type="button"
        onClick={() => { setSuccess(null); setOpen(true); }}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-primary hover:text-brand-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20"
      >
        <MailIcon /> Email estimate
      </button> : null}
      <Link href={printHref} className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-primary hover:text-brand-primary">Print</Link>
    </div>
    {success ? <div aria-live="polite" aria-atomic="true" className="text-right">
      <p role="status" className="text-sm font-medium text-emerald-700">{success}</p>
    </div> : null}
    {open ? <EmailRepairOrderDialog repairOrderId={repairOrderId} defaultRecipient={defaultRecipient} onClose={() => setOpen(false)} onSuccess={sent} /> : null}
  </div>;
}

function EmailRepairOrderDialog({ repairOrderId, defaultRecipient, onClose, onSuccess }: {
  repairOrderId: string;
  defaultRecipient: string;
  onClose: () => void;
  onSuccess: (message?: string) => void;
}) {
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [state, action, pending] = useActionState(sendRepairOrderEmailAction, initialState);
  const submittingRef = useRef(false);
  const titleId = useId();
  const errorId = `${titleId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => { if (!pending) onClose(); }, [onClose, pending]);
  const error = state.status === "error" && !errorDismissed ? state.message || fallbackError : null;

  useEffect(() => {
    if (state.status === "success") onSuccess(state.message);
    if (state.status === "error") submittingRef.current = false;
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
    <button type="button" tabIndex={-1} aria-label="Close Email estimate dialog" disabled={pending} onClick={close} className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-[1px]" />
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
      <h2 id={titleId} className="text-xl font-bold text-slate-950">Email estimate</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Send the customer a copy of this estimate. This does not request authorization.</p>
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
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <input type="hidden" name="mode" value="estimate" />
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
          aria-invalid={Boolean(error)}
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
          <button type="submit" disabled={pending} aria-label={pending ? "Sending estimate" : "Send estimate"} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Sending…" : "Send estimate"}</button>
        </div>
      </form>
    </section>
  </div>, document.body);
}
