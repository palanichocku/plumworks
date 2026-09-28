"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { MarketingLeadSource } from "@/generated/prisma/client";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

export function LeadVerification({ source }: { source: MarketingLeadSource }) {
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const element = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const attempt = useRef<{ form: HTMLFormElement } | null>(null);
  const allowSubmit = useRef(false);
  const busy = useRef(false);
  const [verifying, setVerifying] = useState(false);
  const [failed, setFailed] = useState(false);
  const { pending } = useFormStatus();
  const success = useCallback(() => {
    setFailed(false);
    const current = attempt.current;
    if (!current) return;
    if (!current.form.reportValidity()) {
      attempt.current = null;
      busy.current = false;
      setVerifying(false);
      return;
    }
    setVerifying(false);
    attempt.current = null;
    allowSubmit.current = true;
    current.form.requestSubmit();
  }, []);
  const failure = useCallback(() => {
    attempt.current = null;
    busy.current = false;
    setVerifying(false);
    setFailed(true);
  }, []);
  useEffect(() => {
    const form = element.current?.closest("form");
    if (!form) return;
    const submit = (event: SubmitEvent) => {
      if (allowSubmit.current) {
        allowSubmit.current = false;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy.current || pending) return;
      busy.current = true;
      setVerifying(true);
      setFailed(false);
      attempt.current = { form };
      const startedAt = Number(form.querySelector<HTMLInputElement>('input[name="formStarted"]')?.value.split(".")[1]);
      const elapsed = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
      // UI-only grace period based on the signed server-issued token. The server
      // independently verifies its signature and enforces the same minimum.
      const wait = Math.max(0, 3500 - elapsed);
      window.setTimeout(() => {
        if (attempt.current && widget.current !== null && window.turnstile) {
          try {
            window.turnstile.reset(widget.current);
            window.turnstile.execute(widget.current);
          } catch {
            failure();
          }
        } else {
          attempt.current = null;
          busy.current = false;
          setVerifying(false);
          setFailed(true);
        }
      }, wait);
    };
    form.addEventListener("submit", submit, true);
    return () => form.removeEventListener("submit", submit, true);
  }, [failure, pending]);
  const render = useCallback(() => {
    if (!element.current || !window.turnstile || !sitekey || widget.current !== null) return;
    widget.current = window.turnstile.render(element.current, {
      sitekey, action: source, execution: "execute", appearance: "interaction-only",
      size: element.current.clientWidth < 300 ? "compact" : "flexible", theme: "light",
      callback: success,
      "expired-callback": failure,
      "error-callback": failure,
      "timeout-callback": failure,
    });
  }, [failure, sitekey, source, success]);
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
        if (widget.current !== null && window.turnstile && !busy.current) {
          busy.current = true;
          setFailed(false);
          setVerifying(true);
          const form = element.current?.closest("form");
          if (form) attempt.current = { form };
          try {
            window.turnstile.reset(widget.current);
            window.turnstile.execute(widget.current);
          } catch { failure(); }
        } else if (!window.turnstile) window.location.reload();
      }}>Try verification again</button>.</p>}
      {verifying && <p role="status" className="mb-3 text-sm text-slate-600">Verifying your request…</p>}
    </> : <p role="alert" className="mb-4 text-sm text-slate-700">Online requests are temporarily unavailable. Please call the shop.</p>}
    <noscript><p>Enable JavaScript to verify and send this request, or call the shop.</p></noscript>
    <label className="mb-3 flex items-start gap-3 text-sm font-semibold text-slate-800"><input type="checkbox" name="vehicleServiceIntent" value="yes" required className="mt-1 h-4 w-4 shrink-0 accent-orange-500" /><span>I am contacting Car Doc about service for a vehicle.<span className="mt-1 block text-xs font-normal leading-5 text-slate-600">This form is for vehicle service requests only. Sales, marketing, and other solicitations will be discarded.</span></span></label>
    <button type="submit" disabled={verifying || pending || !sitekey} className="w-full rounded-xl bg-orange-500 px-5 py-3.5 text-sm font-black text-white shadow-sm hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Sending…" : verifying ? "Verifying…" : `Send ${source === "DROP_OFF" ? "Drop-Off" : source === "APPOINTMENT" ? "Appointment" : "Contact"} Request`}</button>
    <p className="mt-3 text-center text-xs text-slate-500">Submitting a request does not guarantee a time. The shop will confirm availability.</p>
    {source === "DROP_OFF" && <p className="mt-3 text-sm font-bold text-amber-900">Wait for confirmation and approved drop-off instructions before leaving keys or a vehicle.</p>}
  </div>;
}
