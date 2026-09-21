"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import toast, { Toaster } from "react-hot-toast";
import { fetchLeadNotifications, markLeadNotificationRead, markAllLeadNotificationsRead } from "@/app/(app)/leads/actions";

type NotificationState = Awaited<ReturnType<typeof fetchLeadNotifications>>;
type Notification = NotificationState["items"][number];
const labels = { CONTACT: "Contact Request", APPOINTMENT: "Appointment Request", DROP_OFF: "Drop-Off Request" };

type NotificationContextValue = {
  state: NotificationState | null;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  error: boolean;
  busy: boolean;
  viewLead: (item: Pick<Notification, "id" | "leadId" | "read">, navigate?: boolean) => Promise<boolean | undefined>;
  markAll: () => Promise<void>;
};
const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useLeadNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("Lead notifications require the shared AppShell provider.");
  return context;
}

export function LeadNotificationProvider({ sessionKey, children }: { sessionKey: string; children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<NotificationState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(false);
  const mutating = useRef(false);
  const revision = useRef(0);

  const viewLead = useCallback(async (item: Pick<Notification, "id" | "leadId" | "read">, navigate = true) => {
    if (mutating.current) return;
    mutating.current = true;
    revision.current++;
    setBusy(true);
    setState((current) => current ? { ...current,
      unreadCount: Math.max(0, current.unreadCount - ((current.items.find((row) => row.id === item.id)?.read ?? item.read) === false ? 1 : 0)),
      items: current.items.map((row) => row.id === item.id ? { ...row, read: true } : row),
    } : current);
    try {
      const { href } = await markLeadNotificationRead(item.id);
      toast.dismiss(`lead-${item.id}`);
      setOpen(false);
      if (navigate) router.push(href);
      return true;
    } catch {
      toast.error("Could not mark this alert read. Please try again.");
      return false;
    } finally {
      try { setState(await fetchLeadNotifications()); } catch { setState(null); setError(true); }
      mutating.current = false;
      setBusy(false);
    }
  }, [router]);

  useEffect(() => {
    const storageKey = `plumworks-lead-toasts:${sessionKey}`;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      if (Array.isArray(stored)) seen.current = new Set(stored.filter((id): id is string => typeof id === "string"));
    } catch { /* Session memory still prevents repeated toasts when storage is unavailable. */ }
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight.current || mutating.current) return;
      inFlight.current = true;
      const startedAtRevision = revision.current;
      try {
        const next = await fetchLeadNotifications();
        if (!active || revision.current !== startedAtRevision || document.visibilityState !== "visible") return;
        setState(next);
        setError(false);
        const fresh = next.items.filter((item) => !item.read && !seen.current.has(item.id));
        for (const item of fresh) seen.current.add(item.id);
        try { sessionStorage.setItem(storageKey, JSON.stringify([...seen.current])); } catch { /* Keep the in-memory set. */ }
        for (const item of fresh.slice(0, 3)) {
          toast.custom((t) => <div role="status" className={`${t.visible ? "opacity-100" : "opacity-0"} w-80 rounded-xl border border-orange-200 bg-white p-4 shadow-xl`}>
            <div className="flex items-start justify-between gap-3"><p className="font-bold text-slate-950">New {labels[item.source]}</p><button aria-label="Dismiss notification" className="px-1 text-slate-500" onClick={() => toast.dismiss(t.id)}>×</button></div>
            <p className="mt-1 text-sm text-slate-600">{item.name}{item.vehicle ? ` — ${item.vehicle}` : ""}</p>
            <button onClick={() => void viewLead(item)} className="mt-3 rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white">View Lead</button>
          </div>, { id: `lead-${item.id}`, duration: 15_000 });
        }
        if (fresh.length > 3) toast(`${fresh.length - 3} more new lead alerts are in your notification center.`, { duration: 15_000 });
      } catch {
        if (active) setError(true);
      } finally { inFlight.current = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    const onReturn = () => void refresh();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      toast.dismiss();
    };
  }, [sessionKey, viewLead]);

  async function markAll() {
    if (!state || mutating.current) return;
    mutating.current = true;
    revision.current++;
    setBusy(true);
    const snapshot = state;
    setState({ ...state, unreadCount: 0, items: state.items.map((item) => ({ ...item, read: true })) });
    try {
      await markAllLeadNotificationsRead(snapshot.asOf);
      toast.dismiss();
    } catch { setState(snapshot); toast.error("Could not mark alerts read. Please try again."); }
    finally {
      try { setState(await fetchLeadNotifications()); } catch { setState(null); setError(true); }
      mutating.current = false;
      setBusy(false);
    }
  }

  return <NotificationContext.Provider value={{ state, open, setOpen, error, busy, viewLead, markAll }}>
    <div className="print:hidden"><Toaster position="top-right" /></div>
    {children}
  </NotificationContext.Provider>;
}
