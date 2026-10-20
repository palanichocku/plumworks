"use client";

import { updateCustomerNotes, updateVehicleNotes } from "@/app/(app)/internal-notes-actions";
import { InternalNoteEditor } from "@/components/internal-note-editor";

export function RepairOrderInternalNotesPanel({ customer, vehicle, canEdit }: {
  customer: { id: string; notes: string | null };
  vehicle?: { id: string; notes: string | null } | null;
  canEdit: boolean;
}) {
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="repair-order-internal-notes-title">
    <div className="flex flex-wrap items-center gap-2">
      <h2 id="repair-order-internal-notes-title" className="text-sm font-bold text-slate-900">Internal notes</h2>
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Not shown to customer</span>
    </div>
    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2"><InternalNoteEditor key={`customer-${customer.id}`} recordId={customer.id} notes={customer.notes} label="Customer note" emptyMessage="none yet" successMessage="Customer note saved." canEdit={canEdit} action={updateCustomerNotes} /></div>
      {vehicle ? <div className="min-w-0 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2"><InternalNoteEditor key={`vehicle-${vehicle.id}`} recordId={vehicle.id} notes={vehicle.notes} label="Vehicle note" emptyMessage="none yet" successMessage="Vehicle note saved." canEdit={canEdit} action={updateVehicleNotes} contextCustomerId={customer.id} /></div> : null}
    </div>
  </section>;
}
