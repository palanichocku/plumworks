import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ensureCurrentRepairOrderRevision, getRepairOrderAuthorizationSummaryForShop } from "@/lib/authorization/repair-order-evidence";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const REMOTE_AUTHORIZATION_CONSENT_VERSION = "2026-10-13-v1";
export const REMOTE_AUTHORIZATION_CONSENT_TEXT = "I confirm that I am authorized to make this decision and that I approve or decline the repair work shown on this exact Repair Order revision.";

type Snapshot = {
  repairOrder?: { id?: string; number?: string | number | null; openedAt?: string; odometer?: number | null; customerComplaint?: string | null; recommendation?: string | null };
  shop?: { name?: string; addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; phone?: string | null };
  customer?: { displayName?: string };
  vehicle?: { year?: number | null; make?: string | null; model?: string | null; engine?: string | null; vin?: string | null; licensePlate?: string | null };
  parts?: Array<{ description?: string; quantity?: string; unitPrice?: string; lineTotal?: string }>;
  labor?: Array<{ description?: string; hours?: string; hourlyRate?: string; complimentary?: boolean; lineTotal?: string }>;
  totals?: { parts?: string; labor?: string; shopSupplies?: string; tax?: string; total?: string };
};

type RequestRow = {
  requestId: string;
  shopId: string;
  documentRevisionId: string;
  documentId: string;
  revision: number;
  snapshotSha256: string;
  snapshot: Snapshot;
  total: string;
  recipientName: string | null;
  recipientEmail: string | null;
  status: "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "REVOKED" | "SUPERSEDED";
  sentAt: Date | null;
  expiresAt: Date;
  decidedAt: Date | null;
};

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validToken(token: string) {
  return TOKEN_PATTERN.test(token);
}

async function requestByToken(token: string): Promise<RequestRow | null> {
  if (!validToken(token)) return null;
  const rows = await prisma.$queryRaw<RequestRow[]>`
    SELECT
      ar.id AS "requestId",
      ar.shop_id AS "shopId",
      ar.document_revision_id AS "documentRevisionId",
      dr.document_id AS "documentId",
      dr.revision,
      dr.snapshot_sha256 AS "snapshotSha256",
      dr.snapshot,
      dr.total::text AS total,
      ar.recipient_name AS "recipientName",
      ar.recipient_email AS "recipientEmail",
      ar.status::text AS status,
      ar.sent_at AS "sentAt",
      ar.expires_at AS "expiresAt",
      ar.decided_at AS "decidedAt"
    FROM authorization_requests ar
    JOIN document_revisions dr ON dr.id = ar.document_revision_id AND dr.shop_id = ar.shop_id
    WHERE ar.token_sha256 = ${hashToken(token)}
      AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function createRepairOrderEmailAuthorizationRequest(input: {
  shopId: string;
  repairOrderId: string;
  recipientEmail: string;
  recipientName?: string | null;
}) {
  const revision = await ensureCurrentRepairOrderRevision(input.shopId, input.repairOrderId);
  if (!revision) throw new Error("Repair Order cannot be prepared for authorization.");

  const token = randomBytes(32).toString("base64url");
  const tokenSha256 = hashToken(token);
  const expiresAt = new Date(Date.now() + REQUEST_LIFETIME_MS);

  const inserted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE authorization_requests ar
      SET status = 'SUPERSEDED'::"AuthorizationRequestStatus", superseded_at = CURRENT_TIMESTAMP
      FROM document_revisions dr
      WHERE ar.document_revision_id = dr.id
        AND ar.shop_id = ${input.shopId}::uuid
        AND dr.shop_id = ${input.shopId}::uuid
        AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
        AND dr.document_id = ${input.repairOrderId}::uuid
        AND ar.status = 'PENDING'::"AuthorizationRequestStatus"
    `;

    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO authorization_requests (
        shop_id, document_revision_id, recipient_name, recipient_email,
        token_sha256, status, expires_at
      ) VALUES (
        ${input.shopId}::uuid,
        ${revision.id}::uuid,
        ${input.recipientName?.trim() || null},
        ${input.recipientEmail},
        ${tokenSha256},
        'PENDING'::"AuthorizationRequestStatus",
        ${expiresAt}
      )
      RETURNING id
    `;
    return rows[0];
  });

  if (!inserted) throw new Error("Authorization request could not be created.");
  return { requestId: inserted.id, token, expiresAt, revision: revision.revision, snapshotSha256: revision.snapshotSha256 };
}

export async function markRepairOrderAuthorizationRequestSent(requestId: string, emailSubject: string) {
  const safeSubject = emailSubject.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  await prisma.$executeRaw`
    UPDATE authorization_requests
    SET sent_at = CURRENT_TIMESTAMP,
        email_subject = ${safeSubject || null}
    WHERE id = ${requestId}::uuid
      AND status = 'PENDING'::"AuthorizationRequestStatus"
  `;
}

export async function revokeRepairOrderAuthorizationRequest(requestId: string) {
  await prisma.$executeRaw`
    UPDATE authorization_requests
    SET status = 'REVOKED'::"AuthorizationRequestStatus", revoked_at = CURRENT_TIMESTAMP
    WHERE id = ${requestId}::uuid
      AND status = 'PENDING'::"AuthorizationRequestStatus"
  `;
}

export async function getPublicRepairOrderAuthorization(token: string) {
  const row = await requestByToken(token);
  if (!row) return null;

  let effectiveStatus = row.status;
  if (effectiveStatus === "PENDING" && row.expiresAt.getTime() <= Date.now()) effectiveStatus = "EXPIRED";

  if (effectiveStatus === "PENDING") {
    const current = await getRepairOrderAuthorizationSummaryForShop(row.shopId, row.documentId);
    if (!current || current.currentSnapshotSha256 !== row.snapshotSha256) effectiveStatus = "SUPERSEDED";
  }

  return { ...row, effectiveStatus };
}

export async function decidePublicRepairOrderAuthorization(input: {
  token: string;
  decision: "APPROVED" | "DECLINED";
  authorizerName: string;
  consentAccepted: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  if (!validToken(input.token)) return { ok: false as const, code: "invalid" as const };
  const authorizerName = input.authorizerName.trim();
  if (authorizerName.length < 2 || authorizerName.length > 120) return { ok: false as const, code: "name" as const };
  if (!input.consentAccepted) return { ok: false as const, code: "consent" as const };

  const existing = await requestByToken(input.token);
  if (!existing) return { ok: false as const, code: "invalid" as const };
  const currentRevision = await ensureCurrentRepairOrderRevision(existing.shopId, existing.documentId);

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<RequestRow[]>`
      SELECT
        ar.id AS "requestId",
        ar.shop_id AS "shopId",
        ar.document_revision_id AS "documentRevisionId",
        dr.document_id AS "documentId",
        dr.revision,
        dr.snapshot_sha256 AS "snapshotSha256",
        dr.snapshot,
        dr.total::text AS total,
        ar.recipient_name AS "recipientName",
        ar.recipient_email AS "recipientEmail",
        ar.status::text AS status,
        ar.sent_at AS "sentAt",
        ar.expires_at AS "expiresAt",
        ar.decided_at AS "decidedAt"
      FROM authorization_requests ar
      JOIN document_revisions dr ON dr.id = ar.document_revision_id AND dr.shop_id = ar.shop_id
      WHERE ar.token_sha256 = ${hashToken(input.token)}
        AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
      FOR UPDATE OF ar
      LIMIT 1
    `;
    const row = locked[0];
    if (!row) return { ok: false as const, code: "invalid" as const };
    if (row.status === "APPROVED" || row.status === "DECLINED") return { ok: true as const, status: row.status, alreadyDecided: true as const };
    if (row.status !== "PENDING") return { ok: false as const, code: row.status.toLowerCase() as "expired" | "revoked" | "superseded" };

    if (row.expiresAt.getTime() <= Date.now()) {
      await tx.$executeRaw`
        UPDATE authorization_requests
        SET status = 'EXPIRED'::"AuthorizationRequestStatus"
        WHERE id = ${row.requestId}::uuid
      `;
      return { ok: false as const, code: "expired" as const };
    }

    if (!currentRevision || currentRevision.snapshotSha256 !== row.snapshotSha256) {
      await tx.$executeRaw`
        UPDATE authorization_requests
        SET status = 'SUPERSEDED'::"AuthorizationRequestStatus", superseded_at = CURRENT_TIMESTAMP
        WHERE id = ${row.requestId}::uuid
      `;
      return { ok: false as const, code: "superseded" as const };
    }

    const safeIp = input.ipAddress?.trim().slice(0, 100) || null;
    const safeUserAgent = input.userAgent?.trim().slice(0, 1000) || null;
    await tx.$executeRaw`
      INSERT INTO authorization_events (
        shop_id, document_revision_id, authorization_request_id,
        method, decision, authorizer_name, amount_authorized, total_discussed,
        consent_text, consent_version, ip_address, user_agent
      ) VALUES (
        ${row.shopId}::uuid,
        ${row.documentRevisionId}::uuid,
        ${row.requestId}::uuid,
        'EMAIL_LINK'::"AuthorizationMethod",
        ${input.decision}::"AuthorizationDecision",
        ${authorizerName},
        ${row.total}::decimal,
        ${row.total}::decimal,
        ${REMOTE_AUTHORIZATION_CONSENT_TEXT},
        ${REMOTE_AUTHORIZATION_CONSENT_VERSION},
        ${safeIp},
        ${safeUserAgent}
      )
    `;

    await tx.$executeRaw`
      UPDATE authorization_requests
      SET status = ${input.decision}::"AuthorizationRequestStatus", decided_at = CURRENT_TIMESTAMP
      WHERE id = ${row.requestId}::uuid
    `;

    return { ok: true as const, status: input.decision, alreadyDecided: false as const };
  });
}
