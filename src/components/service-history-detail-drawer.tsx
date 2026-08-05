"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadServiceHistoryDetail } from "@/app/(app)/service-history-actions";
import { RepairOrderHistoryDetailView } from "@/components/repair-order-history-drawer";
import type { RepairOrderHistoryDetail, RepairOrderHistorySource } from "@/lib/data/repair-order-history";

export function ServiceHistoryDetailDrawer({ context, contextId, source, recordId, onClose }: {
  context: "customer" | "vehicle";
  contextId: string;
  source: RepairOrderHistorySource;
  recordId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<RepairOrderHistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void loadServiceHistoryDetail(context, contextId, source, recordId).then((result) => {
      if (!active) return;
      if (result.ok) setDetail(result.detail);
      else setError(result.message);
    });
    return () => { active = false; };
  }, [context, contextId, recordId, source]);

  useEffect(() => {
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(<div className="fixed inset-0 z-50" role="presentation">
    <button type="button" tabIndex={-1} aria-label="Close service record" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-[1px]" />
    <section ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="absolute inset-y-0 right-0 flex w-full max-w-4xl flex-col overflow-hidden bg-slate-50 text-slate-900 shadow-2xl">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <h2 id={titleId} className="truncate text-xl font-bold text-slate-950">{detail ? `Service Record — RO #${detail.number}` : "Service Record"}</h2>
        <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200">Close</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        {!detail && !error ? <div role="status" aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-medium text-slate-600">Loading service record…</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-medium text-red-800">{error}</div> : null}
        {detail ? <RepairOrderHistoryDetailView detail={detail} showRecordAction /> : null}
      </div>
    </section>
  </div>, document.body);
}
