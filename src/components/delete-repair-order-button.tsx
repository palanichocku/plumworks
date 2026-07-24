"use client";

import { deleteDraftRepairOrder } from "@/app/(app)/repair-orders/delete-actions";
import { FormSubmitButton } from "@/components/form-submit-button";

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>;
}

export function DeleteRepairOrderButton({
  repairOrderId,
  compact = false,
}: {
  repairOrderId: string;
  compact?: boolean;
}) {
  return <form action={deleteDraftRepairOrder}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <FormSubmitButton pendingLabel={compact ? <TrashIcon /> : "Deleting…"} confirmTitle="Delete this draft repair order?" confirmDescription="This cannot be undone. Draft parts and labor lines will be deleted. Customer and vehicle records will remain." confirmLabel="Delete repair order" destructive title="Delete repair order" ariaLabel="Delete repair order" className={compact ? "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:opacity-50" : "rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"}>{compact ? <TrashIcon /> : "Delete"}</FormSubmitButton>
  </form>;
}
