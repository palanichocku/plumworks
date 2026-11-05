import "server-only";

import { prisma } from "@/lib/prisma";
import { ensureCurrentRepairOrderRevision } from "@/lib/authorization/repair-order-evidence";

export type AuthorizationEmailDeliveryStatus = "sent" | "delivered" | "delivery_delayed" | "bounced" | "suppressed" | "failed";

export type AuthorizationEmailDeliveryState = {
  requestStatus: "PENDING" | "EXPIRED";
  recipientEmail: string | null;
  sentAt: string | null;
  expiresAt: string;
  deliveryStatus: AuthorizationEmailDeliveryStatus | null;
};

type DeliveryRow = {
  requestId: string;
  recipientEmail: string | null;
  status: "PENDING" | "EXPIRED";
  sentAt: Date | null;
  expiresAt: Date;
  providerId: string | null;
  deliveryStatus: AuthorizationEmailDeliveryStatus | null;
};

const TERMINAL = new Set<AuthorizationEmailDeliveryStatus>(["delivered", "bounced", "suppressed", "failed"]);

function normalizeResendEvent(value: unknown): AuthorizationEmailDeliveryStatus | null {
  if (typeof value !== "string") return null;
  if (value === "delivered" || value === "opened" || value === "clicked") return "delivered";
  if (value === "delivery_delayed") return "delivery_delayed";
  if (value === "bounced") return "bounced";
  if (value === "suppressed") return "suppressed";
  if (value === "failed") return "failed";
  if (value === "sent" || value === "scheduled" || value === "queued") return "sent";
  return null;
}

async function retrieveResendStatus(providerId: string) {
  const apiKey = process.env.RESEND_STATUS_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { last_event?: unknown };
    return normalizeResendEvent(payload.last_event);
  } catch {
    return null;
  }
}

export async function markAuthorizationEmailProvider(requestId: string, providerId: string) {
  await prisma.$executeRaw`
    UPDATE authorization_requests
    SET email_provider_id = ${providerId},
        email_delivery_status = 'sent',
        email_delivery_checked_at = CURRENT_TIMESTAMP
    WHERE id = ${requestId}::uuid
      AND status = 'PENDING'::"AuthorizationRequestStatus"
  `;
}

export async function getRepairOrderAuthorizationEmailDeliveryState(shopId: string, repairOrderId: string): Promise<AuthorizationEmailDeliveryState | null> {
  const revision = await ensureCurrentRepairOrderRevision(shopId, repairOrderId);
  if (!revision) return null;

  const rows = await prisma.$queryRaw<DeliveryRow[]>`
    SELECT
      ar.id AS "requestId",
      ar.recipient_email AS "recipientEmail",
      ar.status::text AS status,
      ar.sent_at AS "sentAt",
      ar.expires_at AS "expiresAt",
      ar.email_provider_id AS "providerId",
      ar.email_delivery_status AS "deliveryStatus"
    FROM authorization_requests ar
    WHERE ar.shop_id = ${shopId}::uuid
      AND ar.channel = 'EMAIL'
      AND ar.document_revision_id = ${revision.id}::uuid
      AND ar.sent_at IS NOT NULL
      AND ar.status IN ('PENDING'::"AuthorizationRequestStatus", 'EXPIRED'::"AuthorizationRequestStatus")
    ORDER BY ar.created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  if (row.status === "PENDING" && row.expiresAt.getTime() <= Date.now()) {
    await prisma.$executeRaw`
      UPDATE authorization_requests
      SET status = 'EXPIRED'::"AuthorizationRequestStatus"
      WHERE id = ${row.requestId}::uuid
        AND status = 'PENDING'::"AuthorizationRequestStatus"
    `;
    row.status = "EXPIRED";
  }

  if (row.status === "PENDING" && row.providerId && (!row.deliveryStatus || !TERMINAL.has(row.deliveryStatus))) {
    const refreshed = await retrieveResendStatus(row.providerId);
    if (refreshed) {
      row.deliveryStatus = refreshed;
      await prisma.$executeRaw`
        UPDATE authorization_requests
        SET email_delivery_status = ${refreshed},
            email_delivery_checked_at = CURRENT_TIMESTAMP
        WHERE id = ${row.requestId}::uuid
      `;
    }
  }

  return {
    requestStatus: row.status,
    recipientEmail: row.recipientEmail,
    sentAt: row.sentAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    deliveryStatus: row.deliveryStatus,
  };
}
