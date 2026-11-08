"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { SecureSmsQr } from "@/components/secure-sms-qr";
import {
  startSmsConsentSessionAction, getCustomerSmsConsentOverviewAction,
  cancelCustomerSmsConsentSessionAction, type SmsConsentSessionState, type SmsConsentStatus,
} from "@/app/(app)/customers/sms-consent-actions";

const initial: SmsConsentSessionState = { status: "idle", message: "" };
type Item = { id: string; eventType: "OPT_IN" | "OPT_OUT" | "DECLINED";
  method: string; customerName: string | null; phone: string; occurredAt: string };

function displayPhone(value?: string | null) {
  const digits = (value || "").replace(/\\D/g, "");
  return digits.length >= 10 ? `(***) ***-${digits.slice(-4)}` : "Primary mobile";
}
function statusLabel(status: SmsConsentStatus) {
  return status === "CONSENTED" ? "Consented" :
    status === "OPTED_OUT" ? "Opted out — texts blocked" :
    status === "DECLINED" ? "Declined" : "Consent needed";
}
const historyLabel = (item: Item) => item.eventType === "OPT_IN" ? "Consented" :
  item.eventType === "DECLINED" ? "Declined" : "Opted out";
const methodLabel = (method: string) => method === "IN_SHOP_IPAD" ? "Shop iPad" :
  method === "IN_SHOP_QR" ? "Customer phone" :
  method === "TWILIO_STOP" ? "Text STOP" : "Staff verified";

export function CustomerSmsConsentPanel({ customerId, initialStatus, initialPhone }: {
  customerId: string; initialStatus: SmsConsentStatus; initialPhone?: string | null;
}) {
  const [state, action, pending] = useActionState(startSmsConsentSessionAction, initial);
  const [status, setStatus] = useState<SmsConsentStatus>(initialStatus);
  const [method, setMethod] = useState<"IN_SHOP_IPAD" | "IN_SHOP_QR">("IN_SHOP_IPAD");
  const [collecting, setCollecting] = useState(initialStatus !== "CONSENTED" && initialStatus !== "OPTED_OUT");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Item[]>([]);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("PENDING");
  const [clock, setClock] = useState(() => Date.now());
  const [loading, startTransition] = useTransition();
  const session = state.status === "ready" && state.sessionId !== dismissedId ? state : null;
  const visibleSession = session && session.method === method ? session : null;
  const secondsLeft = Math.max(0, Math.ceil(((visibleSession?.expiresAt ? Date.parse(visibleSession.expiresAt) : 0) - clock)/1000));
  const awaiting = Boolean(session && session.expiresAt && Date.parse(session.expiresAt)>clock && progress === "PENDING");

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session?.sessionId) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await getCustomerSmsConsentOverviewAction(customerId, session.sessionId);
        if (!active || !result) return;
        setStatus(result.status);
        setHistory(result.history);
        setProgress(result.progress ?? "PENDING");
        if (result.progress === "COMPLETED") {
          setCollecting(result.status !== "CONSENTED" && result.status !== "OPTED_OUT");
        }
      } catch { /* retry next poll */ }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [customerId, session?.sessionId]);

  const checkHistory = () => {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening) startTransition(async () => {
      const result = await getCustomerSmsConsentOverviewAction(customerId);
      if (result) { setStatus(result.status); setHistory(result.history); }
    });
  };

  const cancel = () => {
    if (!session?.sessionId) return;
    const id = session.sessionId;
    setDismissedId(id);
    startTransition(async () => {
      await cancelCustomerSmsConsentSessionAction(customerId, id);
      const result = await getCustomerSmsConsentOverviewAction(customerId);
      if (result) { setStatus(result.status); setHistory(result.history); }
    });
  };

  const label = statusLabel(status);
  const color = status === "CONSENTED" ? "bg-emerald-100 text-emerald-800" :
    status === "OPTED_OUT" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700";

  return <section className="mt-6 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-slate-950">Text message consent</h2>
        <p className="mt-1 text-sm text-slate-600">Needed before texting estimates. This does not approve repair work.</p>
      </div>
      <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ${color}`}>
        {status === "CONSENTED" ? "✓ " : ""}{label} · {displayPhone(initialPhone)}
      </span>
    </div>

    {status === "CONSENTED" && !collecting ? <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={checkHistory} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800">{historyOpen ? "Hide history" : "View history"}</button>
      <button type="button" onClick={() => { setCollecting(true); setDismissedId(null); }} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800">Recollect consent</button>
      <span className="text-xs text-slate-500">Valid consent applies across Repair Orders for this number.</span>
    </div> : null}

    {status === "OPTED_OUT" ? <div className="mt-4">
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This number has opted out. Texting remains blocked. Resolve the opt-out through the messaging provider before collecting new consent.</p>
      <button type="button" onClick={checkHistory} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold">{historyOpen ? "Hide history" : "View history"}</button>
    </div> : null}

    {collecting && status !== "OPTED_OUT" ? <>
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Select consent device">
        <button type="button" aria-pressed={method==="IN_SHOP_IPAD"} onClick={()=>setMethod("IN_SHOP_IPAD")}
          className={`min-h-12 rounded-lg px-3 text-sm font-semibold ${method==="IN_SHOP_IPAD" ? "bg-slate-900 text-white" : "text-slate-600"}`}>On this iPad</button>
        <button type="button" aria-pressed={method==="IN_SHOP_QR"} onClick={()=>setMethod("IN_SHOP_QR")}
          className={`min-h-12 rounded-lg px-3 text-sm font-semibold ${method==="IN_SHOP_QR" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Customer&apos;s phone</button>
      </div>

      {visibleSession && progress === "COMPLETED" ? <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
        Customer response recorded: {statusLabel(status)}.
      </div> : visibleSession && secondsLeft > 0 && progress === "PENDING" ? <div className="mt-5 rounded-xl border border-slate-200 p-4">
        {method === "IN_SHOP_QR" ? <>
          <div className="grid gap-5 sm:grid-cols-2">
            <div><p className="text-sm font-bold uppercase tracking-wide text-slate-600">1 · Customer scans</p>
              <SecureSmsQr link={visibleSession.link!} /></div>
            <div><p className="text-sm font-bold uppercase tracking-wide text-slate-600">2 · Tell them this code</p>
              <p className="mt-5 text-center font-mono text-4xl font-bold tracking-wider text-slate-900">
                {visibleSession.pin?.slice(0,3)}–{visibleSession.pin?.slice(3)}
              </p>
              <p className="mt-3 text-center text-sm text-slate-600">Only after you have verified the customer in person.</p>
            </div>
          </div>
        </> : <>
          <p className="text-base font-bold text-slate-900">Hand the iPad to the customer</p>
          <p className="mt-1 text-sm text-slate-600">They can review the consent and record a choice. No PIN is needed on this signed-in device.</p>
          <a href={visibleSession.link} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-bold text-white">Open customer-only screen</a>
          <p className="mt-2 text-xs text-slate-500">For added device security, use iPad Guided Access when handing the tablet to a customer.</p>
        </>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-950">
          <span>3 · Waiting for customer to finish</span><span aria-live="polite">Expires in {Math.floor(secondsLeft/60)}:{String(secondsLeft%60).padStart(2,"0")}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-slate-800" style={{width: `${Math.round(secondsLeft/600*100)}%`}}/></div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <form action={action}><input type="hidden" name="customerId" value={customerId}/><input type="hidden" name="method" value={method}/>
            <button disabled={pending} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold">New {method === "IN_SHOP_QR" ? "code" : "session"}</button>
          </form>
          {method==="IN_SHOP_QR" ? <button type="button" onClick={() => { void navigator.clipboard?.writeText(visibleSession.link!); }}
            className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Copy private link</button> : null}
          <button type="button" onClick={cancel} disabled={loading} className="ml-auto min-h-11 px-3 text-sm font-semibold text-slate-600">Cancel</button>
        </div>
      </div> : <>
        <p className="mt-5 text-sm text-slate-600">
          {method === "IN_SHOP_IPAD" ? "Use the shop's signed-in iPad for a PIN-free, in-person handoff." :
            "The customer scans a QR code on their own phone. You give them a six-digit code."}
        </p>
        <form action={action} className="mt-3">
          <input type="hidden" name="customerId" value={customerId}/>
          <input type="hidden" name="method" value={method}/>
          <button disabled={pending} className="min-h-12 rounded-lg bg-slate-900 px-5 font-semibold text-white disabled:opacity-50">
            {pending ? "Preparing…" : method === "IN_SHOP_IPAD" ? "Hand iPad to customer" : "Show QR code"}
          </button>
        </form>
        {visibleSession && (secondsLeft===0 || progress==="CANCELLED" || progress==="EXPIRED") ?
          <p className="mt-2 text-sm text-amber-800">That session ended. Start a new request.</p> : null}
      </>}
      {state.status === "error" ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{state.message}</p> : null}
      {status==="CONSENTED" ? <button type="button" className="mt-4 text-sm font-semibold text-slate-600 underline"
        onClick={()=>setCollecting(false)}>Done collecting</button> : null}
      <button type="button" onClick={checkHistory} className="mt-4 ml-4 text-sm font-semibold text-slate-600 underline">{historyOpen ? "Hide history" : "View history"}</button>
    </> : null}

    {historyOpen ? <div className="mt-5 border-t border-slate-200 pt-4">
      <h3 className="font-bold text-slate-900">Consent history</h3>
      {loading && !history.length ? <p className="mt-2 text-sm text-slate-600">Loading history…</p> :
       history.length ? <ul className="mt-2 space-y-2">{history.map(item=>
        <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <strong>{historyLabel(item)}</strong> · {methodLabel(item.method)} · {item.phone}
          <span className="mt-1 block text-xs text-slate-600">
            {new Date(item.occurredAt).toLocaleString()} {item.customerName ? `· ${item.customerName}` : ""}
          </span>
        </li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No consent decisions recorded.</p>}
    </div> : null}
  </section>;
}
