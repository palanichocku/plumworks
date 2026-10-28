"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/data/membership";
import { getWebRepairOrderForCurrentShop } from "@/lib/data/repair-orders";
import { isRepairOrderReadyForAuthorization } from "@/lib/authorization/repair-order-readiness";
import { recordVerbalRepairOrderAuthorization } from "@/lib/authorization/repair-order-evidence";

export type VerbalAuthorizationActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export async function getRepairOrderAuthorizationReadinessAction(repairOrderId: string): Promise<boolean> {
  const { membership } = await getCurrentMembership();
  if (!membership) return false;
  return isRepairOrderReadyForAuthorization(membership.shopId, repairOrderId);
}

export async function getRepairOrderAuthorizationDefaultsAction(repairOrderId: string): Promise<{ authorizerName: string }> {
  const { membership } = await getCurrentMembership();
  if (!membership) return { authorizerName: "" };
  const order = await getWebRepairOrderForCurrentShop(repairOrderId);
  return { authorizerName: order?.customer.displayName ?? "" };
}

export async function recordVerbalAuthorizationAction(
  _previous: VerbalAuthorizationActionState,
  formData: FormData,
): Promise<VerbalAuthorizationActionState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  try {
    const { membership } = await getCurrentMembership();
    if (!membership) return { status: "error", message: "You must be signed in to record authorization." };
    if (!(await isRepairOrderReadyForAuthorization(membership.shopId, repairOrderId))) {
      return { status: "error", message: "Save draft before recording customer authorization." };
    }

    const result = await recordVerbalRepairOrderAuthorization({
      repairOrderId,
      authorizerName: String(formData.get("authorizerName") ?? ""),
      authorizerRelationship: String(formData.get("authorizerRelationship") ?? ""),
      amountAuthorized: String(formData.get("amountAuthorized") ?? ""),
      totalDiscussed: String(formData.get("totalDiscussed") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
    revalidatePath(`/repair-orders/${repairOrderId}`);
    return { status: "success", message: `Verbal authorization recorded for revision ${result.revision}.` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Authorization could not be recorded." };
  }
}
