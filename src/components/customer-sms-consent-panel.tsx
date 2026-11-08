"use client";
import { useActionState, useState, useTransition } from "react";
import { SecureSmsQr } from "@/components/secure-sms-qr";
import { startSmsConsentSessionAction, getCustomerSmsConsentStatusAction, type SmsConsentSessionState } from "@/app/(app)/customers/sms-consent-actions";

const initial: SmsConsentSessionState = { status: "idle", message: "" };

export function CustomerSmsConsentPanel({ customerId, initialStatus }: {
  customerId: string; initialStatus: "CONSENTED" | "OPTED_OUT" | "MISSING";
}) {
  const [state, action, pending] = useActionState(startSmsConsentSessionAction, initial);
  const [status, setStatus] = useState(initialStatus);
  const [checking, startChecking] = useTransition();
  return <section className="mt-6 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <h2 className="text-lg font-bold text-slate-950">Text message consent</h2>
    <p className="mt-2 text-sm text-slate-600">Current primary mobile: <strong>{status === "CONSENTED" ? "Consented" : status === "OPTED_OUT" ? "Opted out — texts blocked" : "Not opted in"}</strong></p>
    <p className="mt-1 text-xs text-slate-600">Collect customer consent before sending estimates by text. This does not approve repair work.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <form action={action}>
        <input type="hidden" name="customerId" value={customerId} />
        <button name="method" value="IN_SHOP_IPAD" disabled={pending} className="min-h-11 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Collect on this iPad</button>
      </form>
      <form action={action}>
        <input type="hidden" name="customerId" value={customerId} />
        <button name="method" value="IN_SHOP_QR" disabled={pending} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-800 disabled:opacity-50">Create scan link</button>
      </form>
      <button type="button" disabled={checking} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-800" onClick={() => startChecking(async () => setStatus(await getCustomerSmsConsentStatusAction(customerId)))}>Refresh status</button>
    </div>
    {state.status === "error" ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{state.message}</p> : null}
    {state.status === "ready" && state.link ? <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
      <p className="text-sm font-semibold text-slate-900">{state.message}</p>
      <p className="mt-2 text-sm">One-time security PIN: <strong className="font-mono text-xl tracking-widest">{state.pin}</strong></p>
      <p className="mt-1 text-xs text-slate-600">Give the PIN only to the verified customer. Do not share the private link publicly.</p>
      <SecureSmsQr link={state.link} />
      <a href={state.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-brand-primary px-4 text-sm font-bold text-white">Open private consent form</a>
      <p className="mt-2 break-all text-xs text-slate-600">For a separate customer device, scan the QR code or use the private URL below.</p>
      <div className="mt-1 select-all break-all rounded-lg bg-white p-2 font-mono text-xs text-slate-700">{state.link}</div>
    </div> : null}
  </section>;
}
