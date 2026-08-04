"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadRepairOrderHistory, loadRepairOrderHistoryDetail } from "@/app/(app)/repair-orders/history-actions";
import type { RepairOrderHistoryCursor, RepairOrderHistoryDetail, RepairOrderHistoryRow, RepairOrderHistorySource } from "@/lib/data/repair-order-history";

const emptyMessage = "No previous Repair Orders were found for this customer and vehicle.";

export function RepairOrderHistoryDrawer({ currentRepairOrderId, onClose }: { currentRepairOrderId: string; onClose: () => void }) {
  const [rows, setRows] = useState<RepairOrderHistoryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<RepairOrderHistoryCursor | null>(null);
  const [detail, setDetail] = useState<RepairOrderHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void loadRepairOrderHistory(currentRepairOrderId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setRows(result.rows);
        setNextCursor(result.nextCursor);
      } else setError(result.message);
      setLoading(false);
    });
    return () => { active = false; };
  }, [currentRepairOrderId]);

  useEffect(() => {
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
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

  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const result = await loadRepairOrderHistory(currentRepairOrderId, nextCursor);
    if (result.ok) {
      setRows((current) => {
        const known = new Set(current.map((row) => `${row.source}:${row.id}`));
        return [...current, ...result.rows.filter((row) => !known.has(`${row.source}:${row.id}`))];
      });
      setNextCursor(result.nextCursor);
    } else setError(result.message);
    setLoadingMore(false);
  }, [currentRepairOrderId, loadingMore, nextCursor]);

  const showDetail = useCallback(async (source: RepairOrderHistorySource, historicalId: string) => {
    setLoading(true);
    setError(null);
    const result = await loadRepairOrderHistoryDetail(currentRepairOrderId, source, historicalId);
    if (result.ok) setDetail(result.detail);
    else setError(result.message);
    setLoading(false);
  }, [currentRepairOrderId]);

  if (typeof document === "undefined") return null;

  return createPortal(<div className="fixed inset-0 z-50" role="presentation">
    <button type="button" tabIndex={-1} aria-label="Close Repair Order history" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-[1px]" />
    <section ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="absolute inset-y-0 right-0 flex w-full max-w-4xl flex-col overflow-hidden bg-slate-50 text-slate-900 shadow-2xl">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="min-w-0">
          {detail ? <button type="button" onClick={() => { setDetail(null); setError(null); }} className="mb-1 text-sm font-semibold text-brand-primary hover:underline">← Back to History</button> : null}
          <h2 id={titleId} className="truncate text-xl font-bold text-slate-950">{detail ? `Repair Order ${detail.number}` : "Repair Order History"}</h2>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200">Close</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <div aria-live="polite" aria-atomic="true">
          {loading ? <div role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-medium text-slate-600">Loading Repair Order history…</div> : null}
          {!loading && error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-medium text-red-800">{error}</div> : null}
        </div>
        {!loading && !error && detail ? <RepairOrderHistoryDetailView detail={detail} /> : null}
        {!loading && !error && !detail ? <RepairOrderHistoryList rows={rows} nextCursor={nextCursor} loadingMore={loadingMore} onSelect={showDetail} onLoadMore={loadMore} /> : null}
      </div>
    </section>
  </div>, document.body);
}

function RepairOrderHistoryList({ rows, nextCursor, loadingMore, onSelect, onLoadMore }: {
  rows: RepairOrderHistoryRow[];
  nextCursor: RepairOrderHistoryCursor | null;
  loadingMore: boolean;
  onSelect: (source: RepairOrderHistorySource, id: string) => void;
  onLoadMore: () => void;
}) {
  if (!rows.length) return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{emptyMessage}</p>;
  return <div>
    <ul className="space-y-3">
      {rows.map((row) => <li key={`${row.source}:${row.id}`}>
        <button type="button" onClick={() => onSelect(row.source, row.id)} className="grid w-full min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-brand-primary/40 hover:bg-brand-subtle/30 focus:outline-none focus:ring-4 focus:ring-brand-primary/10 sm:grid-cols-[minmax(0,1fr)_auto]">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-950">RO #{row.number}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">{row.status}</span></span>
            <span className="mt-1 block text-sm text-slate-600">{row.date} · Mileage at service: {row.odometer ?? "Not recorded"}</span>
            <span className="mt-2 block truncate text-sm text-slate-800">{row.summary}</span>
          </span>
          <span className="self-center font-bold text-slate-950">{row.total}</span>
        </button>
      </li>)}
    </ul>
    {nextCursor !== null ? <button type="button" disabled={loadingMore} onClick={onLoadMore} className="mt-5 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{loadingMore ? "Loading…" : "Load More"}</button> : null}
  </div>;
}

function RepairOrderHistoryDetailView({ detail }: { detail: RepairOrderHistoryDetail }) {
  return <div className="space-y-5">
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
      <HistoryValue label="Repair Order" value={`#${detail.number}`} /><HistoryValue label="Date" value={detail.date} />
      <HistoryValue label="Status" value={detail.status} capitalize /><HistoryValue label="Mileage at service" value={detail.odometer ?? "Not recorded"} />
      <HistoryValue label="Customer" value={detail.customerName} /><HistoryValue label="Vehicle" value={detail.vehicle} />
      <HistoryValue label="Created" value={detail.createdDate} /><HistoryValue label="Completed" value={detail.completedDate ?? "Not completed"} />
    </section>
    {(detail.complaint || detail.concern || detail.recommendation || detail.notes) ? <section className="grid gap-4 sm:grid-cols-2">
      <HistoryText title="Customer Complaint" value={detail.complaint ?? detail.concern} />
      <HistoryText title="Recommendations" value={detail.recommendation} />
      <HistoryText title="Shop Notes" value={detail.notes} />
    </section> : null}
    <HistoryLines title="Parts" empty="No parts recorded" headings={["Description", "Qty", "Unit price", "Amount"]} rows={detail.parts.map((part) => [part.partNumber ? `${part.description} · Part #${part.partNumber}` : part.description, part.quantity, part.unitPrice, part.amount])} />
    <HistoryLines title="Labor" empty="No labor recorded" headings={["Description", "Hours", "Rate", "Amount"]} rows={detail.labor.map((labor) => [labor.description, labor.hours, labor.hourlyRate, labor.amount])} />
    <section className="ml-auto w-full rounded-xl border border-slate-200 bg-white p-5 sm:max-w-md">
      <h3 className="font-bold text-slate-950">Stored Service Totals</h3>
      <dl className="mt-4 space-y-2 text-sm"><TotalRow label="Parts" value={detail.totals.parts} /><TotalRow label="Labor" value={detail.totals.labor} /><TotalRow label="Subtotal" value={detail.totals.subtotal} />{detail.totals.shopSupplies ? <TotalRow label="Shop Supplies" value={detail.totals.shopSupplies} /> : null}<TotalRow label={detail.source === "invoice" ? "Tax" : "Estimated Tax"} value={detail.totals.tax} /><div className="border-t border-slate-300 pt-2"><TotalRow label={detail.source === "invoice" ? "Total" : "Estimated Total"} value={detail.totals.total} strong /></div></dl>
    </section>
  </div>;
}

function HistoryValue({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 break-words text-sm font-semibold text-slate-900 ${capitalize ? "capitalize" : ""}`}>{value}</p></div>;
}

function HistoryText({ title, value }: { title: string; value: string | null }) {
  if (!value) return null;
  return <article className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-bold text-slate-950">{title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{value}</p></article>;
}

function HistoryLines({ title, empty, headings, rows }: { title: string; empty: string; headings: string[]; rows: string[][] }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-bold text-slate-950">{title}</h3>{rows.length ? <div className="mt-4 space-y-3">{rows.map((row, index) => <div key={`${row[0]}-${index}`} className="grid min-w-0 gap-1 border-t border-slate-100 pt-3 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem]">{row.map((value, cell) => <div key={headings[cell]} className={cell ? "sm:text-right" : "min-w-0"}><span className="block text-xs font-medium text-slate-500 sm:hidden">{headings[cell]}</span><span className="block break-words text-sm text-slate-800">{value}</span></div>)}</div>)}</div> : <p className="mt-3 text-sm text-slate-500">{empty}</p>}</section>;
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 ${strong ? "font-bold text-slate-950" : "text-slate-700"}`}><dt>{label}</dt><dd>{value}</dd></div>;
}
