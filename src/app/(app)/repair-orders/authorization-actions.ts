"use server";

import { revalidatePath } from "next/cache";
import { recordVerbalRepairOrderAuthorization } from "@/lib/authorization/repair-order-evidence";

export type VerbalAuthorizationActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export async function recordVerbalAuthorizationAction(
  _previous: VerbalAuthorizationActionState,
  formData: FormData,
): Promise<VerbalAuthorizationActionState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  try {
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
