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
      decision: String(formData.get("decision") ?? "") as "APPROVED" | "DECLINED",
      authorizerRelationship: String(formData.get("authorizerRelationship") ?? ""),
      amountAuthorized: String(formData.get("amountAuthorized") ?? ""),
      totalDiscussed: String(formData.get("totalDiscussed") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
    revalidatePath(`/repair-orders/${repairOrderId}`);
    return { status: "success", message: `Phone decision recorded for revision ${result.revision}.` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Authorization could not be recorded." };
  }
}


/**
 * Communication-neutral status check for a customer-facing approval link.
 * Email and SMS authorization requests share the same PENDING lifecycle and
 * the same public approval/decline decision handler.
 */
export async function hasPendingRemoteRepairOrderAuthorizationAction(repairOrderId: string): Promise<boolean> {
  const { membership } = await getCurrentMembership();
  if (!membership || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(repairOrderId)) {
    return false;
  }
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.$queryRaw<Array<{ pending: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM authorization_requests ar
      JOIN document_revisions dr ON dr.id = ar.document_revision_id AND dr.shop_id = ar.shop_id
      WHERE ar.shop_id = ${membership.shopId}::uuid
        AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
        AND dr.document_id = ${repairOrderId}::uuid
        AND ar.status = 'PENDING'::"AuthorizationRequestStatus"
        AND ar.expires_at > CURRENT_TIMESTAMP
        AND ar.channel IN ('EMAIL', 'SMS')
    ) AS pending
  `;
  return rows[0]?.pending === true;
}
