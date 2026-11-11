"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitSmsConsent, verifySmsConsentPinAction } from "@/app/sms-consent/[token]/actions";

type Props = {
  token: string; shopName: string; customerName: string; phone: string; disclosure: string;
  method: "IN_SHOP_IPAD" | "IN_SHOP_QR"; returnRoId?: string | null; error?: boolean;
};

export function SmsConsentCustomerFlow({ token, shopName, customerName, phone, disclosure, method, returnRoId, error }: Props) {
  const phonePath = method === "IN_SHOP_QR";
  const [pin, setPin] = useState("");
  const [verified, setVerified] = useState(!phonePath);
  const [pinError, setPinError] = useState(Boolean(error));
  const [wrongNumber, setWrongNumber] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [confirmedName, setConfirmedName] = useState(customerName);
  const [pending, startTransition] = useTransition();

  const verify = () => {
    if (!/^\d{6}$/.test(pin)) return;
    startTransition(async () => {
      const ok = await verifySmsConsentPinAction(token, pin);
      if (ok) { setVerified(true); setPinError(false); }
      else { setPinError(true); setPin(""); }
    });
  };

  return <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:py-12">
    <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <p className="text-sm font-bold uppercase tracking-wide text-slate-600">{shopName}</p>
      {wrongNumber ? <>
        <h1 className="mt-3 text-2xl font-bold">That's not my number</h1>
        <p className="mt-4 text-slate-700">Please tell the person helping you at the shop. They can correct the customer record and start a new consent request. No text messages have been enrolled.</p>
      </> : !verified ? <>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Enter the code from the shop</h1>
        <p className="mt-3 text-slate-600">The person helping you will tell you a six-digit code.</p>
        <label className="mt-7 block text-sm font-semibold" htmlFor="consent-pin">Six-digit security code</label>
        <input id="consent-pin" type="text" autoComplete="one-time-code" inputMode="numeric"
          pattern="[0-9]*" maxLength={6} value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g,"").slice(0,6)); setPinError(false); }}
          className="mt-2 block min-h-16 w-full rounded-xl border-2 border-slate-300 bg-slate-50 px-4 text-center font-mono text-3xl tracking-[0.4em] focus:border-slate-800 focus:outline-none"
          placeholder="••••••" aria-describedby={pinError ? "pin-error" : undefined} />
        {pinError ? <p id="pin-error" role="alert" className="mt-3 text-sm font-semibold text-red-700">That code did not match, or your link expired. Check with the shop for a new code if needed.</p> : null}
        <button type="button" disabled={pin.length !== 6 || pending} onClick={verify}
          className="mt-6 min-h-12 w-full rounded-xl bg-slate-900 px-5 py-3 text-base font-bold text-white disabled:bg-slate-300 disabled:text-slate-500">
          {pending ? "Checking…" : "Continue"}
        </button>
      </> : <>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Get your estimate by text</h1>
        <p className="mt-2 text-base font-semibold text-slate-800">Customer: {customerName}</p>
        <p className="mt-3 text-slate-600">Choose whether {shopName} may text you repair estimates and service updates. This does not authorize repair work.</p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-100 p-4">
          <div><p className="text-xs text-slate-600">Texts will go to</p><p className="text-xl font-bold">{phone}</p></div>
          <button type="button" onClick={() => setWrongNumber(true)}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Not my number</button>
        </div>
        <form action={submitSmsConsent} className="mt-6">
          <input type="hidden" name="token" value={token} />
          {method === "IN_SHOP_IPAD" && returnRoId ? <input type="hidden" name="returnRoId" value={returnRoId} /> : null}
          {phonePath ? <input type="hidden" name="pin" value={pin} /> : null}
          <label className="block text-sm font-semibold">Confirm your full name
            <input name="customerName" value={confirmedName} onChange={e=>setConfirmedName(e.target.value)}
              minLength={2} maxLength={120} autoComplete="name"
              className="mt-2 block min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" />
          </label>
          <p className="mt-2 text-xs text-slate-600">Your name was filled from the shop's customer record. Correct it if needed before accepting.</p>
          <label className="mt-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6">
            <input type="checkbox" name="consentConfirmed" value="yes" checked={agreed} onChange={e=>setAgreed(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0" aria-label="I agree to the SMS disclosure"/>
            <span>{disclosure}</span>
          </label>
          <div className="mt-3 text-xs text-slate-600">
            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</Link>
            {" · "}
            <Link href="/sms-terms" target="_blank" rel="noopener noreferrer" className="underline">SMS Terms &amp; Conditions</Link>
          </div>
          <div className="mt-7 grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <button type="submit" name="decision" value="agree" disabled={!agreed || confirmedName.trim().length < 2 || pending}
              className="min-h-12 rounded-xl bg-slate-900 px-5 font-bold text-white disabled:bg-slate-300 disabled:text-slate-500">Accept SMS consent</button>
            <button type="submit" name="decision" value="decline"
              className="min-h-12 rounded-xl border border-slate-300 px-5 font-bold text-slate-800">Decline</button>
          </div>
        </form>
      </>}
      <p className="mt-6 text-center text-xs text-slate-500">
        {phonePath ? "Using your phone" : "In-shop iPad handoff"} · Secure, single-use consent request
      </p>
    </section>
  </main>;
}
