"use client";

import { deleteDraftRepairOrder } from "@/app/(app)/repair-orders/delete-actions";

export function DeleteRepairOrderButton({
  repairOrderId,
  compact = false,
}: {
  repairOrderId: string;
  compact?: boolean;
}) {
  return <form action={deleteDraftRepairOrder} onSubmit={(event) => {
    if (!window.confirm("Delete this draft repair order? Its draft parts and labor lines will also be deleted.")) event.preventDefault();
  }}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <button type="submit" title="Delete repair order" aria-label="Delete repair order" className={compact ? "rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-700" : "rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"}>{compact ? <span aria-hidden="true">⌫</span> : "Delete"}</button>
  </form>;
}
