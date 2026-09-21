"use client";

import { useEffect, useRef } from "react";
import { useLeadNotifications } from "@/components/lead-notification-provider";
const labels = { CONTACT: "Contact Request", APPOINTMENT: "Appointment Request", DROP_OFF: "Drop-Off Request" };

function age(createdAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(createdAt).toLocaleDateString();
}

export function LeadNotificationCenter() {
  const { state, open, setOpen, error, busy, viewLead, markAll } = useLeadNotifications();
  const panel = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); bell.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, setOpen]);

  return <div ref={panel} className="relative">
    <button ref={bell} type="button" aria-label={`Lead notifications${state ? `, ${state.unreadCount} unread` : ""}`} aria-expanded={open} aria-controls="lead-notification-panel" onClick={() => setOpen(!open)} className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-primary">
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {!!state?.unreadCount && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-orange-600 px-1 text-center text-[11px] font-bold leading-5 text-white">{state.unreadCount > 99 ? "99+" : state.unreadCount}</span>}
      {error && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-amber-500" />}
    </button>
    {open && <section id="lead-notification-panel" aria-label="Lead notifications" className="fixed right-3 top-16 z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-xl lg:absolute lg:right-0 lg:top-12">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4"><h2 className="font-bold">Lead notifications</h2><button disabled={busy || !state?.unreadCount} onClick={() => void markAll()} className="text-xs font-semibold text-brand-primary disabled:text-slate-400">Mark all as read</button></div>
      {error && <p role="status" className="bg-amber-50 p-3 text-sm text-amber-900">Notifications are temporarily unavailable. Retrying automatically.</p>}
      {!state && !error && <p className="p-5 text-sm text-slate-500">Loading notifications…</p>}
      {state && !state.enabled && <p className="p-5 text-sm text-slate-500">In-app lead notifications are turned off in Shop Settings.</p>}
      {state?.enabled && state.items.length === 0 && <p className="p-5 text-sm text-slate-500">No lead notifications yet.</p>}
      <ul className="max-h-[60vh] overflow-y-auto">{state?.items.map((item) => <li key={item.id} className="border-b border-slate-100 last:border-0">
        <button disabled={busy} onClick={() => void viewLead(item)} className={`block w-full px-4 py-3 text-left hover:bg-slate-100 disabled:opacity-60 ${item.read ? "bg-white" : "bg-orange-50/60"}`}>
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-600">{labels[item.source]}</span>{!item.read && <span className="text-xs font-bold text-orange-700">Unread</span>}</div>
          <p className="mt-1 font-semibold text-slate-950">{item.name}</p>{item.vehicle && <p className="mt-0.5 text-sm text-slate-600">{item.vehicle}</p>}
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><time dateTime={item.createdAt}>{age(item.createdAt)}</time><span className="rounded bg-slate-100 px-2 py-0.5 font-semibold">{item.status}</span></div>
        </button>
      </li>)}</ul>
      {!!state?.items.length && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Latest 20 alerts · Reading an alert does not change lead status.</p>}
    </section>}
  </div>;
}
