"use server";

import { revalidatePath } from "next/cache";
import { updateRepairOrderConcerns, type RepairOrderSaveState } from "@/app/(app)/repair-orders/actions";
import { getCurrentMembership } from "@/lib/data/membership";
import { ensureCurrentRepairOrderRevision } from "@/lib/authorization/repair-order-evidence";

export async function saveRepairOrderDraftForAuthorization(
  previousState: RepairOrderSaveState,
  formData: FormData,
): Promise<RepairOrderSaveState> {
  const result = await updateRepairOrderConcerns(previousState, formData);
  if (result.status !== "success") return result;

  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const { membership } = await getCurrentMembership();
  if (!membership) return { status: "error", message: "You must be signed in to save this Repair Order." };

  const revision = await ensureCurrentRepairOrderRevision(membership.shopId, repairOrderId);
  if (!revision) return { status: "error", message: "This Repair Order could not be prepared for authorization." };

  revalidatePath(`/repair-orders/${repairOrderId}`);
  return { status: "success", message: `Repair Order saved as revision ${revision.revision}.` };
}
