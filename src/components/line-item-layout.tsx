import type { ReactNode } from "react";

export const lineItemCardClass = "min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
export const baseLineItemRowClass = "grid min-w-0 items-end gap-3";
export const partLineItemRowClass = `${baseLineItemRowClass} ro-part-row`;
export const laborLineItemRowClass = `${baseLineItemRowClass} ro-labor-row`;

export const addLineItemButtonClass = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-primary text-brand-primary hover:bg-brand-subtle focus:outline-none focus:ring-4 focus:ring-brand-primary/10 disabled:opacity-50";
export const saveLineItemButtonClass = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-900 text-white hover:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:opacity-40";
export const deleteLineItemButtonClass = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:opacity-50";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);

export function LineItemAmountActions({ amount, children }: { amount: number; children: ReactNode }) {
  return <div className="flex min-w-48 items-end justify-between gap-3"><div className="min-w-20"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</span><p className="mt-2 whitespace-nowrap tabular-nums font-semibold text-slate-900">{money(amount)}</p></div><div className="flex shrink-0 items-center gap-2">{children}</div></div>;
}

export function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>;
}

export function PlusIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5"><path d="M12 5v14M5 12h14" /></svg>;
}

export function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="m5 12 4 4L19 6" /></svg>;
}

export function PendingIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 animate-spin"><circle cx="12" cy="12" r="9" className="opacity-25" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>;
}

export function ClearLineItemButton({ label, onClear }: { label: string; onClear: () => void }) {
  return <button type="button" aria-label={label} title={label} onClick={onClear} className={deleteLineItemButtonClass}><TrashIcon /></button>;
}
