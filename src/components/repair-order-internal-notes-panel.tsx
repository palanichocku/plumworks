"use client";

import { updateCustomerNotes, updateVehicleNotes } from "@/app/(app)/internal-notes-actions";
import { InternalNoteEditor } from "@/components/internal-note-editor";

export function RepairOrderInternalNotesPanel({ customer, vehicle, canEdit }: {
  customer: { id: string; notes: string | null };
  vehicle?: { id: string; notes: string | null } | null;
  canEdit: boolean;
}) {
  return <section className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50/60 p-5" aria-labelledby="repair-order-internal-notes-title">
    <div>
      <h2 id="repair-order-internal-notes-title" className="text-sm font-bold uppercase tracking-wider text-slate-900">Internal notes</h2>
      <p className="mt-1 text-xs font-medium text-amber-900">Not shown to customer</p>
    </div>
    <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-amber-100 bg-white/70 p-4"><InternalNoteEditor key={`customer-${customer.id}`} recordId={customer.id} notes={customer.notes} label="Customer" emptyMessage="No internal customer note" successMessage="Customer note saved." canEdit={canEdit} action={updateCustomerNotes} /></div>
      {vehicle ? <div className="min-w-0 rounded-xl border border-amber-100 bg-white/70 p-4"><InternalNoteEditor key={`vehicle-${vehicle.id}`} recordId={vehicle.id} notes={vehicle.notes} label="Vehicle" emptyMessage="No internal vehicle note" successMessage="Vehicle note saved." canEdit={canEdit} action={updateVehicleNotes} contextCustomerId={customer.id} /></div> : null}
    </div>
  </section>;
}
