"use client";

import { deleteDraftRepairOrder } from "@/app/(app)/repair-orders/delete-actions";
import { FormSubmitButton } from "@/components/form-submit-button";

export function DeleteRepairOrderButton({
  repairOrderId,
  compact = false,
}: {
  repairOrderId: string;
  compact?: boolean;
}) {
  return <form action={deleteDraftRepairOrder}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <FormSubmitButton pendingLabel={compact ? "…" : "Deleting…"} confirmTitle="Delete this draft repair order?" confirmDescription="This cannot be undone. Draft parts and labor lines will be deleted. Customer and vehicle records will remain." confirmLabel="Delete repair order" destructive title="Delete repair order" ariaLabel="Delete repair order" className={compact ? "rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50" : "rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"}>{compact ? <span aria-hidden="true">⌫</span> : "Delete"}</FormSubmitButton>
  </form>;
}
