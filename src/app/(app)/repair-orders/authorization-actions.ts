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

/** Latest authorization-request delivery status, for either email or SMS. */
export async function getRepairOrderRemoteDeliveryStatusAction(repairOrderId: string): Promise<{
  channel: "EMAIL" | "SMS";
  requestStatus: "PENDING" | "EXPIRED" | "APPROVED" | "DECLINED" | "REVOKED" | "SUPERSEDED";
  recipientEmail: string | null;
  recipientPhone: string | null;
  sentAt: string | null;
  expiresAt: string;
  deliveryStatus: string | null;
} | null> {
  const { membership } = await getCurrentMembership();
  if (!membership || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(repairOrderId)) return null;
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.$queryRaw<Array<{
    channel: string; requestStatus: string; recipientEmail: string | null;
    recipientPhone: string | null; sentAt: Date | null; expiresAt: Date;
    deliveryStatus: string | null;
  }>>`
    SELECT ar.channel, ar.status::text AS "requestStatus",
      ar.recipient_email AS "recipientEmail", ar.recipient_phone AS "recipientPhone",
      ar.sent_at AS "sentAt", ar.expires_at AS "expiresAt",
      CASE WHEN ar.channel = 'SMS' THEN ar.sms_delivery_status
           ELSE ar.email_delivery_status END AS "deliveryStatus"
    FROM authorization_requests ar
    JOIN document_revisions dr ON dr.id = ar.document_revision_id AND dr.shop_id = ar.shop_id
    WHERE ar.shop_id = ${membership.shopId}::uuid
      AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
      AND dr.document_id = ${repairOrderId}::uuid
      AND ar.channel IN ('EMAIL', 'SMS')
      AND ar.status IN ('PENDING', 'EXPIRED') 
    ORDER BY ar.created_at DESC, ar.id DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || (row.channel !== "EMAIL" && row.channel !== "SMS")) return null;
  return {
    channel: row.channel, requestStatus: row.requestStatus as "PENDING" | "EXPIRED",
    recipientEmail: row.recipientEmail, recipientPhone: row.recipientPhone,
    sentAt: row.sentAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(), deliveryStatus: row.deliveryStatus,
  };
}
