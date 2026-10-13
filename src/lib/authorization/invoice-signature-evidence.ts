import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { canonicalJson, sha256CanonicalJson } from "@/lib/authorization/canonical-json";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const MAX_SIGNATURE_BYTES = 750 * 1024;

export const CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_VERSION = "2026-10-13-v1";
export const CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_TEXT =
  "I acknowledge receipt of the vehicle and the final invoice shown here, including the listed work and total.";
export const SHOP_DELIVERY_ACKNOWLEDGEMENT_TEXT =
  "I confirm that I am the shop representative completing this vehicle delivery and that I witnessed the customer acknowledgement shown here.";

type Db = typeof prisma | Prisma.TransactionClient;

function money(value: { toString(): string } | number | string | null | undefined) {
  return value == null ? "0.00" : Number(value.toString()).toFixed(2);
}

function validateSignatureData(dataUrl: string) {
  const match = PNG_DATA_URL.exec(dataUrl);
  if (!match) throw new Error("Signature image is invalid.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 100) throw new Error("Please provide a signature before accepting.");
  if (bytes.length > MAX_SIGNATURE_BYTES) throw new Error("Signature image is too large.");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function loadInvoiceSnapshot(db: Db, shopId: string, invoiceId: string) {
  if (!UUID.test(invoiceId)) return null;
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, shopId, legacySourceTable: null, status: { not: "void" } },
    select: {
      id: true,
      repairOrderId: true,
      repairOrderNumber: true,
      invoiceDate: true,
      status: true,
      odometer: true,
      customerComplaint: true,
      recommendation: true,
      partsTotal: true,
      laborTotal: true,
      shopSuppliesAmount: true,
      discountAmount: true,
      taxTotal: true,
      total: true,
      paidTotal: true,
      shop: { select: { name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true } },
      customer: { select: { id: true, displayName: true, email: true, phone: true } },
      vehicle: { select: { id: true, year: true, make: true, model: true, odometer: true } },
      parts: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, partNumber: true, quantity: true, unitPrice: true, vendorNameSnapshot: true } },
      labor: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, hours: true, hourlyRate: true, complimentary: true, shopSuppliesEligible: true } },
    },
  });
  if (!invoice) return null;

  const snapshot = {
    schemaVersion: 1,
    documentType: "INVOICE",
    invoice: {
      id: invoice.id,
      repairOrderId: invoice.repairOrderId,
      number: invoice.repairOrderNumber,
      invoiceDate: invoice.invoiceDate?.toISOString() ?? null,
      status: invoice.status,
      odometer: invoice.odometer,
      customerComplaint: invoice.customerComplaint,
      recommendation: invoice.recommendation,
    },
    shop: invoice.shop,
    customer: invoice.customer,
    vehicle: invoice.vehicle,
    parts: invoice.parts.map((part) => ({
      id: part.id,
      description: part.description,
      partNumber: part.partNumber,
      quantity: part.quantity.toString(),
      unitPrice: money(part.unitPrice),
      vendorName: part.vendorNameSnapshot,
      lineTotal: money(part.quantity.mul(part.unitPrice)),
    })),
    labor: invoice.labor.map((line) => ({
      id: line.id,
      description: line.description,
      hours: line.hours.toString(),
      hourlyRate: money(line.hourlyRate),
      complimentary: line.complimentary,
      shopSuppliesEligible: line.shopSuppliesEligible,
      lineTotal: money(line.complimentary ? 0 : line.hours.mul(line.hourlyRate)),
    })),
    totals: {
      parts: money(invoice.partsTotal),
      labor: money(invoice.laborTotal),
      shopSupplies: money(invoice.shopSuppliesAmount),
      discount: money(invoice.discountAmount),
      tax: money(invoice.taxTotal),
      total: money(invoice.total),
      paid: money(invoice.paidTotal),
    },
  };

  return { snapshot, hash: sha256CanonicalJson(snapshot), total: money(invoice.total) };
}

type RevisionRow = { id: string; revision: number; snapshotSha256: string };

type SignatureRow = {
  eventId: string;
  sessionId: string;
  role: "CUSTOMER" | "SHOP_REPRESENTATIVE";
  signerName: string;
  occurredAt: Date;
  staffUserEmail: string | null;
  consentText: string | null;
  consentVersion: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  signatureData: string;
  signatureSha256: string;
  revision: number;
  snapshotSha256: string;
};

async function ensureRevisionInTransaction(tx: Prisma.TransactionClient, shopId: string, invoiceId: string, current: NonNullable<Awaited<ReturnType<typeof loadInvoiceSnapshot>>>) {
  const existing = await tx.$queryRaw<RevisionRow[]>`
    SELECT id, revision, snapshot_sha256 AS "snapshotSha256"
    FROM document_revisions
    WHERE shop_id = ${shopId}::uuid
      AND document_type = 'INVOICE'::"DocumentEvidenceType"
      AND document_id = ${invoiceId}::uuid
      AND snapshot_sha256 = ${current.hash}
    ORDER BY revision DESC
    LIMIT 1
  `;
  if (existing[0]) return { ...existing[0], total: current.total };

  const inserted = await tx.$queryRaw<RevisionRow[]>`
    INSERT INTO document_revisions (shop_id, document_type, document_id, revision, snapshot, snapshot_sha256, total)
    SELECT
      ${shopId}::uuid,
      'INVOICE'::"DocumentEvidenceType",
      ${invoiceId}::uuid,
      COALESCE(MAX(revision), 0) + 1,
      ${canonicalJson(current.snapshot)}::jsonb,
      ${current.hash},
      ${current.total}::decimal
    FROM document_revisions
    WHERE shop_id = ${shopId}::uuid
      AND document_type = 'INVOICE'::"DocumentEvidenceType"
      AND document_id = ${invoiceId}::uuid
    RETURNING id, revision, snapshot_sha256 AS "snapshotSha256"
  `;
  if (!inserted[0]) throw new Error("Invoice evidence revision could not be created.");
  return { ...inserted[0], total: current.total };
}

export async function getInvoiceDeliverySignatureEvidence(invoiceId: string) {
  if (!UUID.test(invoiceId)) return null;
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, shopId: membership.shopId },
    select: { id: true, repairOrderNumber: true, status: true, legacySourceTable: true, total: true },
  });
  if (!invoice) return null;

  const current = invoice.legacySourceTable || invoice.status === "void" ? null : await loadInvoiceSnapshot(prisma, membership.shopId, invoiceId);
  const signatures = await prisma.$queryRaw<SignatureRow[]>`
    SELECT
      ae.id AS "eventId",
      ae.signature_session_id AS "sessionId",
      ae.signature_role::text AS role,
      ae.authorizer_name AS "signerName",
      ae.occurred_at AS "occurredAt",
      ae.staff_user_email AS "staffUserEmail",
      ae.consent_text AS "consentText",
      ae.consent_version AS "consentVersion",
      ae.ip_address AS "ipAddress",
      ae.user_agent AS "userAgent",
      se.signature_data AS "signatureData",
      se.signature_sha256 AS "signatureSha256",
      dr.revision,
      dr.snapshot_sha256 AS "snapshotSha256"
    FROM authorization_events ae
    JOIN document_revisions dr ON dr.id = ae.document_revision_id AND dr.shop_id = ae.shop_id
    JOIN signature_evidence se ON se.authorization_event_id = ae.id AND se.shop_id = ae.shop_id
    WHERE ae.shop_id = ${membership.shopId}::uuid
      AND dr.document_type = 'INVOICE'::"DocumentEvidenceType"
      AND dr.document_id = ${invoiceId}::uuid
      AND ae.method = 'IN_PERSON_SIGNATURE'::"AuthorizationMethod"
      AND ae.decision = 'DELIVERY_ACKNOWLEDGED'::"AuthorizationDecision"
      AND ae.signature_session_id IS NOT NULL
      AND ae.signature_role IS NOT NULL
    ORDER BY ae.occurred_at DESC, ae.id DESC
  `;

  const currentSessionIds = current
    ? new Set(signatures.filter((row) => row.snapshotSha256 === current.hash).map((row) => row.sessionId))
    : new Set<string>();
  const currentComplete = Array.from(currentSessionIds).some((sessionId) => {
    const roles = new Set(signatures.filter((row) => row.sessionId === sessionId).map((row) => row.role));
    return roles.has("CUSTOMER") && roles.has("SHOP_REPRESENTATIVE");
  });

  return { invoice, signatures, currentSnapshotSha256: current?.hash ?? null, currentComplete };
}

export async function recordInvoiceDeliverySignatures(input: {
  invoiceId: string;
  customerName: string;
  customerSignatureData: string;
  shopRepresentativeName: string;
  shopRepresentativeSignatureData: string;
  customerConsentAccepted: boolean;
  shopConsentAccepted: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership || !hasPermission(membership.role, "finalize_repair_order")) {
    throw new Error("You do not have permission to capture delivery signatures.");
  }
  if (!UUID.test(input.invoiceId)) throw new Error("Invoice is invalid.");
  const customerName = input.customerName.trim();
  const shopRepresentativeName = input.shopRepresentativeName.trim();
  if (customerName.length < 2 || customerName.length > 120) throw new Error("Enter the customer's printed name.");
  if (shopRepresentativeName.length < 2 || shopRepresentativeName.length > 120) throw new Error("Enter the shop representative's printed name.");
  if (!input.customerConsentAccepted || !input.shopConsentAccepted) throw new Error("Both acknowledgements must be accepted.");

  const customerSignature = validateSignatureData(input.customerSignatureData);
  const shopSignature = validateSignatureData(input.shopRepresentativeSignatureData);
  const safeIp = input.ipAddress?.trim().slice(0, 100) || null;
  const safeUserAgent = input.userAgent?.trim().slice(0, 1000) || null;
  const sessionId = randomUUID();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.invoiceId}))`;
    const current = await loadInvoiceSnapshot(tx, membership.shopId, input.invoiceId);
    if (!current) throw new Error("Invoice was not found or cannot be signed.");
    const revision = await ensureRevisionInTransaction(tx, membership.shopId, input.invoiceId, current);

    const alreadySigned = await tx.$queryRaw<Array<{ sessionId: string }>>`
      SELECT ae.signature_session_id AS "sessionId"
      FROM authorization_events ae
      WHERE ae.shop_id = ${membership.shopId}::uuid
        AND ae.document_revision_id = ${revision.id}::uuid
        AND ae.method = 'IN_PERSON_SIGNATURE'::"AuthorizationMethod"
        AND ae.decision = 'DELIVERY_ACKNOWLEDGED'::"AuthorizationDecision"
        AND ae.signature_session_id IS NOT NULL
      GROUP BY ae.signature_session_id
      HAVING COUNT(*) FILTER (WHERE ae.signature_role = 'CUSTOMER'::"SignatureRole") > 0
         AND COUNT(*) FILTER (WHERE ae.signature_role = 'SHOP_REPRESENTATIVE'::"SignatureRole") > 0
      LIMIT 1
    `;
    if (alreadySigned[0]) throw new Error("Delivery signatures are already on file for this invoice revision.");

    const customerEvents = await tx.$queryRaw<Array<{ id: string; occurredAt: Date }>>`
      INSERT INTO authorization_events (
        shop_id, document_revision_id, method, decision, authorizer_name, authorizer_relationship,
        amount_authorized, total_discussed, notes, staff_user_id, staff_user_email,
        consent_text, consent_version, ip_address, user_agent, signature_role, signature_session_id
      ) VALUES (
        ${membership.shopId}::uuid, ${revision.id}::uuid,
        'IN_PERSON_SIGNATURE'::"AuthorizationMethod", 'DELIVERY_ACKNOWLEDGED'::"AuthorizationDecision",
        ${customerName}, 'Customer', ${revision.total}::decimal, ${revision.total}::decimal,
        'Customer delivery acknowledgement', ${user.id}::uuid, ${user.email ?? null},
        ${CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_TEXT}, ${CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_VERSION},
        ${safeIp}, ${safeUserAgent}, 'CUSTOMER'::"SignatureRole", ${sessionId}::uuid
      )
      RETURNING id, occurred_at AS "occurredAt"
    `;
    const customerEvent = customerEvents[0];
    if (!customerEvent) throw new Error("Customer signature evidence could not be recorded.");

    const shopEvents = await tx.$queryRaw<Array<{ id: string; occurredAt: Date }>>`
      INSERT INTO authorization_events (
        shop_id, document_revision_id, method, decision, authorizer_name, authorizer_relationship,
        amount_authorized, total_discussed, notes, staff_user_id, staff_user_email,
        consent_text, consent_version, ip_address, user_agent, signature_role, signature_session_id
      ) VALUES (
        ${membership.shopId}::uuid, ${revision.id}::uuid,
        'IN_PERSON_SIGNATURE'::"AuthorizationMethod", 'DELIVERY_ACKNOWLEDGED'::"AuthorizationDecision",
        ${shopRepresentativeName}, 'Shop representative', ${revision.total}::decimal, ${revision.total}::decimal,
        'Shop representative delivery acknowledgement', ${user.id}::uuid, ${user.email ?? null},
        ${SHOP_DELIVERY_ACKNOWLEDGEMENT_TEXT}, ${CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_VERSION},
        ${safeIp}, ${safeUserAgent}, 'SHOP_REPRESENTATIVE'::"SignatureRole", ${sessionId}::uuid
      )
      RETURNING id, occurred_at AS "occurredAt"
    `;
    const shopEvent = shopEvents[0];
    if (!shopEvent) throw new Error("Shop signature evidence could not be recorded.");

    await tx.$executeRaw`
      INSERT INTO signature_evidence (shop_id, authorization_event_id, mime_type, signature_data, signature_sha256)
      VALUES
        (${membership.shopId}::uuid, ${customerEvent.id}::uuid, 'image/png', ${input.customerSignatureData}, ${customerSignature.sha256}),
        (${membership.shopId}::uuid, ${shopEvent.id}::uuid, 'image/png', ${input.shopRepresentativeSignatureData}, ${shopSignature.sha256})
    `;

    return {
      sessionId,
      revision: revision.revision,
      snapshotSha256: revision.snapshotSha256,
      customerOccurredAt: customerEvent.occurredAt,
      shopOccurredAt: shopEvent.occurredAt,
    };
  });
}
