import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";
import { canonicalJson, sha256CanonicalJson } from "@/lib/authorization/canonical-json";
import type { AuthorizationHistoryItem, RepairOrderAuthorizationSummary, VerbalAuthorizationInput } from "@/lib/authorization/evidence-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function money(value: { toString(): string } | number | string | null | undefined) {
  return value == null ? "0.00" : Number(value.toString()).toFixed(2);
}

function decimalInput(value: string, label: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) throw new Error(`${label} must be a valid dollar amount.`);
  const number = Number(trimmed);
  if (!Number.isFinite(number) || number < 0 || number > 9_999_999_999.99) throw new Error(`${label} is out of range.`);
  return number.toFixed(2);
}

async function loadRepairOrderSnapshot(shopId: string, repairOrderId: string) {
  if (!UUID.test(repairOrderId)) return null;
  const order = await prisma.repairOrder.findFirst({
    where: { id: repairOrderId, shopId, legacySourceTable: null, status: { not: "void" } },
    select: {
      id: true,
      repairOrderNumber: true,
      openedAt: true,
      odometer: true,
      customerComplaint: true,
      recommendation: true,
      partsTotal: true,
      laborTotal: true,
      taxTotal: true,
      estimatedTotal: true,
      shopSuppliesEnabledSnapshot: true,
      shopSuppliesRateSnapshot: true,
      shopSuppliesCapSnapshot: true,
      shopSuppliesAmount: true,
      shop: { select: { name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true } },
      customer: { select: { id: true, displayName: true, email: true, phone: true } },
      vehicle: { select: { id: true, year: true, make: true, model: true, engine: true, vin: true, licensePlate: true } },
      parts: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, quantity: true, unitPrice: true, vendorNameSnapshot: true } },
      labor: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, hours: true, hourlyRate: true, complimentary: true, shopSuppliesEligible: true } },
    },
  });
  if (!order) return null;

  const snapshot = {
    schemaVersion: 1,
    documentType: "REPAIR_ORDER",
    repairOrder: {
      id: order.id,
      number: order.repairOrderNumber,
      openedAt: order.openedAt.toISOString(),
      odometer: order.odometer,
      customerComplaint: order.customerComplaint,
      recommendation: order.recommendation,
    },
    shop: order.shop,
    customer: order.customer,
    vehicle: order.vehicle,
    parts: order.parts.map((part) => ({
      id: part.id,
      description: part.description,
      quantity: part.quantity.toString(),
      unitPrice: money(part.unitPrice),
      vendorName: part.vendorNameSnapshot,
      lineTotal: money(part.quantity.mul(part.unitPrice)),
    })),
    labor: order.labor.map((line) => ({
      id: line.id,
      description: line.description,
      hours: line.hours.toString(),
      hourlyRate: money(line.hourlyRate),
      complimentary: line.complimentary,
      shopSuppliesEligible: line.shopSuppliesEligible,
      lineTotal: money(line.complimentary ? 0 : line.hours.mul(line.hourlyRate)),
    })),
    totals: {
      parts: money(order.partsTotal),
      labor: money(order.laborTotal),
      shopSupplies: money(order.shopSuppliesAmount),
      tax: money(order.taxTotal),
      total: money(order.estimatedTotal),
      shopSuppliesEnabled: order.shopSuppliesEnabledSnapshot,
      shopSuppliesRate: order.shopSuppliesRateSnapshot.toString(),
      shopSuppliesCap: money(order.shopSuppliesCapSnapshot),
    },
  };

  return { snapshot, hash: sha256CanonicalJson(snapshot), total: money(order.estimatedTotal) };
}

type RevisionRow = { id: string; revision: number; snapshotSha256: string };
type ApprovalRow = { revision: number; occurredAt: Date; authorizerName: string };
type HistoryRow = AuthorizationHistoryItem;

async function ensureCurrentRevision(shopId: string, repairOrderId: string) {
  const current = await loadRepairOrderSnapshot(shopId, repairOrderId);
  if (!current) return null;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${repairOrderId}))`;
    const existing = await tx.$queryRaw<RevisionRow[]>`
      SELECT id, revision, snapshot_sha256 AS "snapshotSha256"
      FROM document_revisions
      WHERE shop_id = ${shopId}::uuid
        AND document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
        AND document_id = ${repairOrderId}::uuid
        AND snapshot_sha256 = ${current.hash}
      ORDER BY revision DESC
      LIMIT 1
    `;
    if (existing[0]) return { ...existing[0], total: current.total };

    const inserted = await tx.$queryRaw<RevisionRow[]>`
      INSERT INTO document_revisions (shop_id, document_type, document_id, revision, snapshot, snapshot_sha256, total)
      SELECT
        ${shopId}::uuid,
        'REPAIR_ORDER'::"DocumentEvidenceType",
        ${repairOrderId}::uuid,
        COALESCE(MAX(revision), 0) + 1,
        ${canonicalJson(current.snapshot)}::jsonb,
        ${current.hash},
        ${current.total}::decimal
      FROM document_revisions
      WHERE shop_id = ${shopId}::uuid
        AND document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
        AND document_id = ${repairOrderId}::uuid
      RETURNING id, revision, snapshot_sha256 AS "snapshotSha256"
    `;
    return inserted[0] ? { ...inserted[0], total: current.total } : null;
  });
}

export async function getRepairOrderAuthorizationSummary(repairOrderId: string): Promise<RepairOrderAuthorizationSummary | null> {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  const current = await loadRepairOrderSnapshot(membership.shopId, repairOrderId);
  if (!current) return null;

  const approved = await prisma.$queryRaw<ApprovalRow[]>`
    SELECT dr.revision, ae.occurred_at AS "occurredAt", ae.authorizer_name AS "authorizerName"
    FROM document_revisions dr
    JOIN authorization_events ae ON ae.document_revision_id = dr.id AND ae.shop_id = dr.shop_id
    WHERE dr.shop_id = ${membership.shopId}::uuid
      AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
      AND dr.document_id = ${repairOrderId}::uuid
      AND dr.snapshot_sha256 = ${current.hash}
      AND ae.decision = 'APPROVED'::"AuthorizationDecision"
    ORDER BY ae.occurred_at DESC
    LIMIT 1
  `;

  return approved[0]
    ? { status: "AUTHORIZED", currentSnapshotSha256: current.hash, approvedRevision: approved[0].revision, approvedAt: approved[0].occurredAt, authorizerName: approved[0].authorizerName }
    : { status: "NOT_AUTHORIZED", currentSnapshotSha256: current.hash, approvedRevision: null, approvedAt: null, authorizerName: null };
}

export async function getRepairOrderAuthorizationHistory(repairOrderId: string): Promise<AuthorizationHistoryItem[]> {
  const { membership } = await getCurrentMembership();
  if (!membership || !UUID.test(repairOrderId)) return [];
  return prisma.$queryRaw<HistoryRow[]>`
    SELECT
      ae.id,
      dr.revision,
      ae.method::text AS method,
      ae.decision::text AS decision,
      ae.authorizer_name AS "authorizerName",
      ae.authorizer_relationship AS "authorizerRelationship",
      ae.amount_authorized::text AS "amountAuthorized",
      ae.total_discussed::text AS "totalDiscussed",
      ae.notes,
      ae.staff_user_email AS "staffUserEmail",
      ae.occurred_at AS "occurredAt",
      dr.snapshot_sha256 AS "snapshotSha256"
    FROM authorization_events ae
    JOIN document_revisions dr ON dr.id = ae.document_revision_id AND dr.shop_id = ae.shop_id
    WHERE ae.shop_id = ${membership.shopId}::uuid
      AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
      AND dr.document_id = ${repairOrderId}::uuid
    ORDER BY ae.occurred_at DESC, ae.id DESC
  `;
}

export async function recordVerbalRepairOrderAuthorization(input: VerbalAuthorizationInput) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) throw new Error("You must be signed in to record authorization.");
  if (!UUID.test(input.repairOrderId)) throw new Error("Repair order is invalid.");
  const authorizerName = input.authorizerName.trim();
  if (authorizerName.length < 2 || authorizerName.length > 120) throw new Error("Enter the name of the person who authorized the work.");
  const relationship = input.authorizerRelationship?.trim() || null;
  if (relationship && relationship.length > 120) throw new Error("Relationship/role is too long.");
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 1000) throw new Error("Notes must be 1,000 characters or fewer.");
  const amountAuthorized = decimalInput(input.amountAuthorized, "Amount authorized");
  const totalDiscussed = decimalInput(input.totalDiscussed, "Total discussed");
  const revision = await ensureCurrentRevision(membership.shopId, input.repairOrderId);
  if (!revision) throw new Error("Repair order was not found or cannot be authorized.");

  const inserted = await prisma.$queryRaw<Array<{ id: string; occurredAt: Date }>>`
    INSERT INTO authorization_events (
      shop_id, document_revision_id, method, decision, authorizer_name, authorizer_relationship,
      amount_authorized, total_discussed, notes, staff_user_id, staff_user_email
    ) VALUES (
      ${membership.shopId}::uuid, ${revision.id}::uuid,
      'PHONE'::"AuthorizationMethod", 'APPROVED'::"AuthorizationDecision",
      ${authorizerName}, ${relationship}, ${amountAuthorized}::decimal, ${totalDiscussed}::decimal,
      ${notes}, ${user.id}::uuid, ${user.email ?? null}
    )
    RETURNING id, occurred_at AS "occurredAt"
  `;
  if (!inserted[0]) throw new Error("Authorization could not be recorded.");
  return { id: inserted[0].id, occurredAt: inserted[0].occurredAt, revision: revision.revision, snapshotSha256: revision.snapshotSha256 };
}
