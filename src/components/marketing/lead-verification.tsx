"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { MarketingLeadSource } from "@/generated/prisma/client";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

export function LeadVerification({ source }: { source: MarketingLeadSource }) {
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const element = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const wasPending = useRef(false);
  const [verified, setVerified] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const { pending } = useFormStatus();
  useEffect(() => {
    const form = element.current?.closest("form");
    // Keep the submitted token intact for transport, but don't reuse it after
    // a failed request that leaves this component mounted.
    const submitting = () => setVerified(false);
    form?.addEventListener("submit", submitting);
    return () => form?.removeEventListener("submit", submitting);
  }, []);
  useEffect(() => {
    if (wasPending.current && !pending && widget.current !== null) window.turnstile?.reset(widget.current);
    wasPending.current = pending;
  }, [pending]);
  useEffect(() => {
    // Give even instant autofill a grace period beyond the server's minimum.
    const timer = window.setTimeout(() => setReady(true), 500);
    return () => window.clearTimeout(timer);
  }, []);
  const render = useCallback(() => {
    if (!element.current || !window.turnstile || !sitekey || widget.current !== null) return;
    widget.current = window.turnstile.render(element.current, {
      sitekey, action: source, size: element.current.clientWidth < 300 ? "compact" : "flexible", theme: "light",
      callback: () => { setVerified(true); setFailed(false); },
      "expired-callback": () => { setVerified(false); setFailed(true); },
      "error-callback": () => { setVerified(false); setFailed(true); },
      "timeout-callback": () => { setVerified(false); setFailed(true); },
    });
  }, [sitekey, source]);
  useEffect(() => {
    render();
    return () => {
      if (widget.current !== null) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [render]);
  return <div className="min-w-0 sm:col-span-2">
    <div aria-hidden="true" className="hidden">
      <label>Website<input name="website" tabIndex={-1} autoComplete="off" maxLength={200} /></label>
    </div>
    {sitekey ? <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={render} onError={() => setFailed(true)} />
      <div ref={element} className="mb-4 min-w-0" />
      {failed && <p role="alert" className="mb-4 text-sm text-red-800">Verification couldn’t finish. <button type="button" className="underline" onClick={() => {
        setVerified(false); setFailed(false);
        if (widget.current !== null && window.turnstile) window.turnstile.reset(widget.current);
        else window.location.reload();
      }}>Try verification again</button>.</p>}
      {!verified && !failed && <p role="status" className="mb-3 text-sm text-slate-600">Please complete the verification before sending your request.</p>}
    </> : <p role="alert" className="mb-4 text-sm text-slate-700">Online requests are temporarily unavailable. Please call the shop.</p>}
    <noscript><p>Enable JavaScript to verify and send this request, or call the shop.</p></noscript>
    <button disabled={!ready || !verified || pending} className="w-full rounded-xl bg-orange-500 px-5 py-3.5 text-sm font-black text-white shadow-sm hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Sending…" : `Send ${source === "DROP_OFF" ? "Drop-Off" : source === "APPOINTMENT" ? "Appointment" : "Contact"} Request`}</button>
    <p className="mt-3 text-center text-xs text-slate-500">Submitting a request does not guarantee a time. The shop will confirm availability.</p>
    {source === "DROP_OFF" && <p className="mt-3 text-sm font-bold text-amber-900">Wait for confirmation and approved drop-off instructions before leaving keys or a vehicle.</p>}
  </div>;
}
