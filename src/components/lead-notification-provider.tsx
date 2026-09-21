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
  markAllBusy: boolean;
  pendingReadIds: ReadonlySet<string>;
  viewLead: (item: Pick<Notification, "id" | "leadId" | "read">, navigate?: boolean) => Promise<boolean>;
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
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [pendingReadIds, setPendingReadIds] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef(new Set<string>());
  const inFlight = useRef(false);
  const pendingReads = useRef(new Map<string, Promise<boolean>>());
  const markingAll = useRef(false);
  const requestNumber = useRef(0);
  const revision = useRef(0);

  const withPendingReads = useCallback((next: NotificationState): NotificationState => {
    const unreadPending = next.items.filter((item) => !item.read && pendingReads.current.has(item.id)).length;
    return { ...next, unreadCount: Math.max(0, next.unreadCount - unreadPending),
      items: next.items.map((item) => pendingReads.current.has(item.id) ? { ...item, read: true } : item),
    };
  }, []);

  const reconcile = useCallback(async () => {
    const startedAtRevision = revision.current;
    const request = ++requestNumber.current;
    try {
      const next = await fetchLeadNotifications();
      if (revision.current !== startedAtRevision || request !== requestNumber.current) return;
      setState(withPendingReads(next));
      setError(false);
    } catch {
      if (revision.current !== startedAtRevision || request !== requestNumber.current) return;
      setState(null);
      setError(true);
    }
  }, [withPendingReads]);

  const viewLead = useCallback((item: Pick<Notification, "id" | "leadId" | "read">, navigate = true): Promise<boolean> => {
    setOpen(false);
    toast.dismiss(`lead-${item.id}`);
    if (navigate) router.push(`/leads/${item.leadId}`);
    // Repeated clicks still navigate; only the duplicate write is coalesced.
    const pending = pendingReads.current.get(item.id);
    if (pending) return pending;
    revision.current++;
    setState((current) => current ? { ...current,
      unreadCount: Math.max(0, current.unreadCount - ((current.items.find((row) => row.id === item.id)?.read ?? item.read) === false ? 1 : 0)),
      items: current.items.map((row) => row.id === item.id ? { ...row, read: true } : row),
    } : current);
    const work = (async () => {
      let saved = false;
      try {
        await markLeadNotificationRead(item.id);
        saved = true;
      } catch {
        toast.error(navigate ? "Lead opened, but the notification could not be marked read." : "Could not mark this alert read. Please try again.");
      } finally {
        pendingReads.current.delete(item.id);
        setPendingReadIds(new Set(pendingReads.current.keys()));
        revision.current++;
        await reconcile();
      }
      return saved;
    })();
    pendingReads.current.set(item.id, work);
    setPendingReadIds(new Set(pendingReads.current.keys()));
    return work;
  }, [router, reconcile]);

  useEffect(() => {
    const storageKey = `plumworks-lead-toasts:${sessionKey}`;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      if (Array.isArray(stored)) seen.current = new Set(stored.filter((id): id is string => typeof id === "string"));
    } catch { /* Session memory still prevents repeated toasts when storage is unavailable. */ }
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight.current) return;
      inFlight.current = true;
      const startedAtRevision = revision.current;
      const request = ++requestNumber.current;
      try {
        const next = await fetchLeadNotifications();
        if (!active || revision.current !== startedAtRevision || request !== requestNumber.current || document.visibilityState !== "visible") return;
        const reconciled = withPendingReads(next);
        setState(reconciled);
        setError(false);
        const fresh = reconciled.items.filter((item) => !item.read && !seen.current.has(item.id));
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
        if (active && revision.current === startedAtRevision && request === requestNumber.current) setError(true);
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
  }, [sessionKey, viewLead, withPendingReads]);

  async function markAll() {
    if (!state || markingAll.current) return;
    markingAll.current = true;
    revision.current++;
    setMarkAllBusy(true);
    try {
      await markAllLeadNotificationsRead(state.asOf);
      toast.dismiss();
    } catch { toast.error("Could not mark alerts read. Please try again."); }
    finally {
      markingAll.current = false;
      setMarkAllBusy(false);
      revision.current++;
      await reconcile();
    }
  }

  return <NotificationContext.Provider value={{ state, open, setOpen, error, markAllBusy, pendingReadIds, viewLead, markAll }}>
    <div className="print:hidden"><Toaster position="top-right" /></div>
    {children}
  </NotificationContext.Provider>;
}
