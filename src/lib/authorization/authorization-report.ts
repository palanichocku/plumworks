import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Snapshot = {
  repairOrder?: { id?: string; number?: string | number | null; openedAt?: string; odometer?: number | null; customerComplaint?: string | null; recommendation?: string | null };
  shop?: { name?: string; addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; phone?: string | null };
  customer?: { id?: string; displayName?: string; email?: string | null; phone?: string | null };
  vehicle?: { id?: string; year?: number | null; make?: string | null; model?: string | null; engine?: string | null; vin?: string | null; licensePlate?: string | null };
  parts?: Array<{ id?: string; description?: string; quantity?: string; unitPrice?: string; vendorName?: string | null; lineTotal?: string }>;
  labor?: Array<{ id?: string; description?: string; hours?: string; hourlyRate?: string; complimentary?: boolean; shopSuppliesEligible?: boolean; lineTotal?: string }>;
  totals?: { parts?: string; labor?: string; shopSupplies?: string; tax?: string; total?: string };
};

export type AuthorizationEvidenceRecord = {
  eventId: string;
  revision: number;
  snapshotSha256: string;
  snapshot: Snapshot;
  method: "PHONE" | "EMAIL_LINK" | "IN_PERSON_SIGNATURE";
  decision: "APPROVED" | "DECLINED" | "DELIVERY_ACKNOWLEDGED";
  authorizerName: string;
  authorizerRelationship: string | null;
  amountAuthorized: string | null;
  totalDiscussed: string | null;
  notes: string | null;
  staffUserEmail: string | null;
  consentText: string | null;
  consentVersion: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: Date;
  requestId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  requestStatus: string | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  decidedAt: Date | null;
};

export async function getRepairOrderAuthorizationEvidence(repairOrderId: string) {
  if (!UUID.test(repairOrderId)) return null;
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  const order = await prisma.repairOrder.findFirst({
    where: { id: repairOrderId, shopId: membership.shopId },
    select: { id: true, repairOrderNumber: true, status: true },
  });
  if (!order) return null;

  const records = await prisma.$queryRaw<AuthorizationEvidenceRecord[]>`
    SELECT
      ae.id AS "eventId",
      dr.revision,
      dr.snapshot_sha256 AS "snapshotSha256",
      dr.snapshot,
      ae.method::text AS method,
      ae.decision::text AS decision,
      ae.authorizer_name AS "authorizerName",
      ae.authorizer_relationship AS "authorizerRelationship",
      ae.amount_authorized::text AS "amountAuthorized",
      ae.total_discussed::text AS "totalDiscussed",
      ae.notes,
      ae.staff_user_email AS "staffUserEmail",
      ae.consent_text AS "consentText",
      ae.consent_version AS "consentVersion",
      ae.ip_address AS "ipAddress",
      ae.user_agent AS "userAgent",
      ae.occurred_at AS "occurredAt",
      ar.id AS "requestId",
      ar.recipient_name AS "recipientName",
      ar.recipient_email AS "recipientEmail",
      ar.status::text AS "requestStatus",
      ar.sent_at AS "sentAt",
      ar.expires_at AS "expiresAt",
      ar.decided_at AS "decidedAt"
    FROM authorization_events ae
    JOIN document_revisions dr ON dr.id = ae.document_revision_id AND dr.shop_id = ae.shop_id
    LEFT JOIN authorization_requests ar ON ar.id = ae.authorization_request_id AND ar.shop_id = ae.shop_id
    WHERE ae.shop_id = ${membership.shopId}::uuid
      AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
      AND dr.document_id = ${repairOrderId}::uuid
    ORDER BY ae.occurred_at DESC, ae.id DESC
  `;

  return { order, records };
}
