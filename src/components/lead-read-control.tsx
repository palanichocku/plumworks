"use client";

import { useState } from "react";
import { useLeadNotifications } from "@/components/lead-notification-provider";

export type LeadReadNotification = { id: string; leadId: string; read: boolean };

export function LeadReadControl({ notification }: { notification: LeadReadNotification | null }) {
  const { state, busy, viewLead } = useLeadNotifications();
  const [readHere, setReadHere] = useState(false);
  if (!notification || state?.enabled === false) return null;
  const read = state?.items.find((item) => item.id === notification.id)?.read ?? (readHere || notification.read);
  if (read) return null;
  return <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
    <span className="font-bold">Unread notification</span>
    <button disabled={busy} onClick={async () => { if (await viewLead(notification, false)) setReadHere(true); }} className="font-semibold underline disabled:opacity-50">Mark as read</button>
  </div>;
}
