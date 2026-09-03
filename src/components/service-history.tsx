"use client";

import { useRef, useState } from "react";
import { ServiceHistoryDetailDrawer } from "@/components/service-history-detail-drawer";
import { formatDate, formatMoney } from "@/lib/formatters";
import type { RepairOrderHistorySource } from "@/lib/data/repair-order-history";

type HistoryPart = { id: string; description: string; partNumber: string | null; vendorNameSnapshot: string | null };
type RelatedVehicle = { id: string; year: number | null; make: string | null; model: string | null } | null;
type RelatedCustomer = { id: string; displayName: string };
type InvoiceHistoryItem = { id: string; legacyRoNo: string | null; repairOrderNumber: number | null; invoiceDate: Date | null; status: string; total: { toString(): string }; parts: HistoryPart[]; vehicle?: RelatedVehicle; customer?: RelatedCustomer };
type RepairOrderHistoryItem = { id: string; legacyRoNo: string | null; repairOrderNumber: number | null; openedAt: Date; estimatedTotal: { toString(): string }; status: string; odometer: number | null; legacySourceTable: string | null; parts: HistoryPart[]; vehicle?: RelatedVehicle; customer?: RelatedCustomer };
type DisplayEntry = { source: RepairOrderHistorySource; id: string; legacyRoNo: string | null; repairOrderNumber: number | null; date: Date | null; status: string; total: { toString(): string }; parts: HistoryPart[]; vehicle?: RelatedVehicle; customer?: RelatedCustomer };

export function ServiceHistory({ context, contextId, invoices, repairOrders, showVehicle = false, showCustomer = false }: { context: "customer" | "vehicle"; contextId: string; invoices: InvoiceHistoryItem[]; repairOrders: RepairOrderHistoryItem[]; showVehicle?: boolean; showCustomer?: boolean }) {
  const [selected, setSelected] = useState<{ source: RepairOrderHistorySource; id: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sourceRank: Record<RepairOrderHistorySource, number> = { invoice: 1, repairOrder: 0 };
  const entries: DisplayEntry[] = [
    ...invoices.map((invoice) => ({ ...invoice, source: "invoice" as const, date: invoice.invoiceDate })),
    ...repairOrders.map((order) => ({ ...order, source: "repairOrder" as const, date: order.openedAt, total: order.estimatedTotal })),
  ].sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0) || sourceRank[right.source] - sourceRank[left.source] || right.id.localeCompare(left.id)).slice(0, 50);

  const closeDetail = () => {
    setSelected(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return <>
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5"><h2 className="text-lg font-semibold text-slate-950">Service history</h2><p className="mt-1 text-sm text-slate-600">Most recent 50 service records.</p></div>
      {entries.length === 0 ? <p className="px-6 py-8 text-sm text-slate-600">No service history is available.</p> : <ul className="divide-y divide-slate-200">
        {entries.map((entry) => {
          const vehicle = entry.vehicle ? [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable" : "Vehicle not linked";
          return <li key={`${entry.source}:${entry.id}`} className="px-6 py-4 transition hover:bg-slate-50">
            <button type="button" onClick={(event) => { triggerRef.current = event.currentTarget; setSelected({ source: entry.source, id: entry.id }); }} className="grid w-full gap-2 rounded text-left focus:outline-none focus:ring-4 focus:ring-brand-primary/10 sm:grid-cols-[1fr_1fr_auto] sm:items-center" aria-label={`Open internal service record RO ${entry.repairOrderNumber ?? entry.legacyRoNo ?? "Not recorded"}`}>
              <span><span className="block font-semibold text-brand-primary underline-offset-2 hover:underline">RO #{entry.repairOrderNumber ?? entry.legacyRoNo ?? "Not recorded"}{entry.source === "invoice" && entry.status === "void" ? <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">VOID</span> : null}</span><span className="text-sm text-slate-500">{formatDate(entry.date)}</span>{entry.parts.length > 0 ? <span className="mt-3 block space-y-2">{entry.parts.map((part) => <span key={part.id} className="block text-sm"><span className="block font-medium text-slate-800">{part.description}</span><span className="block text-xs text-slate-500">Part #: {part.partNumber ?? "Not recorded"} · Vendor: {part.vendorNameSnapshot?.trim() || "Not recorded"}</span></span>)}</span> : null}</span>
              <span className="text-sm text-slate-600">{showVehicle ? vehicle : null}{showCustomer ? entry.customer?.displayName ?? "Customer unavailable" : null}</span>
              <span className="font-medium text-slate-900">{formatMoney(entry.total)}</span>
            </button>
          </li>;
        })}
      </ul>}
    </section>
    {selected ? <ServiceHistoryDetailDrawer context={context} contextId={contextId} source={selected.source} recordId={selected.id} onClose={closeDetail} /> : null}
  </>;
}
