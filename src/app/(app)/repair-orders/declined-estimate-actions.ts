"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { refreshRepairOrderTotals } from "@/lib/repair-order-totals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeclinedSnapshot = {
  repairOrder?: {
    id?: string;
    number?: string | number | null;
    odometer?: number | null;
    customerComplaint?: string | null;
    recommendation?: string | null;
  };
  customer?: { id?: string; displayName?: string };
  vehicle?: { id?: string };
  parts?: Array<{
    description?: string;
    quantity?: string;
    unitPrice?: string;
    vendorName?: string | null;
  }>;
  labor?: Array<{
    description?: string;
    hours?: string;
    hourlyRate?: string;
    complimentary?: boolean;
    shopSuppliesEligible?: boolean;
  }>;
};

type DeclinedEvidenceRow = {
  eventId: string;
  revision: number;
  snapshotSha256: string;
  snapshot: unknown;
  occurredAt: Date;
};

function decimalValue(value: string | undefined, label: string, { positive = false }: { positive?: boolean } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0) || number > 1_000_000) {
    throw new Error(`The declined estimate contains an invalid ${label}.`);
  }
  return number.toFixed(2);
}

export async function createRepairOrderFromDeclinedEstimate(formData: FormData) {
  const sourceRepairOrderId = String(formData.get("sourceRepairOrderId") ?? "");
  const authorizationEventId = String(formData.get("authorizationEventId") ?? "");
  if (!UUID.test(sourceRepairOrderId) || !UUID.test(authorizationEventId)) {
    throw new Error("The declined estimate reference is invalid.");
  }

  const { user, membership } = await requirePermission("create_repair_order");

  const evidence = await prisma.$queryRaw<DeclinedEvidenceRow[]>`
    SELECT
      ae.id AS "eventId",
      dr.revision,
      dr.snapshot_sha256 AS "snapshotSha256",
      dr.snapshot,
      ae.occurred_at AS "occurredAt"
    FROM authorization_events ae
    JOIN document_revisions dr
      ON dr.id = ae.document_revision_id
      AND dr.shop_id = ae.shop_id
    WHERE ae.id = ${authorizationEventId}::uuid
      AND ae.shop_id = ${membership.shopId}::uuid
      AND ae.decision = 'DECLINED'::"AuthorizationDecision"
      AND dr.document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
      AND dr.document_id = ${sourceRepairOrderId}::uuid
    LIMIT 1
  `;

  const record = evidence[0];
  if (!record) throw new Error("The declined estimate could not be found.");

  const snapshot = record.snapshot as DeclinedSnapshot;
  const customerId = snapshot.customer?.id ?? "";
  const vehicleId = snapshot.vehicle?.id ?? "";
  if (!UUID.test(customerId) || !UUID.test(vehicleId) || snapshot.repairOrder?.id !== sourceRepairOrderId) {
    throw new Error("The declined estimate does not contain a valid customer and vehicle reference.");
  }

  const [customer, vehicle] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, shopId: membership.shopId, archivedAt: null },
      select: { id: true },
    }),
    prisma.vehicle.findFirst({
      where: { id: vehicleId, shopId: membership.shopId, customerId, archivedAt: null, customer: { archivedAt: null } },
      select: { id: true },
    }),
  ]);
  if (!customer || !vehicle) {
    throw new Error("The customer or vehicle from this estimate is archived or no longer available. Restore it before creating a new Repair Order.");
  }

  const parts = (snapshot.parts ?? []).map((part) => {
    const description = String(part.description ?? "").trim();
    if (!description || description.length > 500) throw new Error("The declined estimate contains an invalid part description.");
    return {
      description,
      quantity: decimalValue(part.quantity, "part quantity", { positive: true }),
      unitPrice: decimalValue(part.unitPrice, "part price"),
      vendorNameSnapshot: part.vendorName?.trim() || null,
    };
  });

  const labor = (snapshot.labor ?? []).map((line) => {
    const description = String(line.description ?? "").trim();
    if (!description || description.length > 500) throw new Error("The declined estimate contains an invalid labor description.");
    return {
      description,
      hours: decimalValue(line.hours, "labor hours", { positive: !line.complimentary }),
      hourlyRate: decimalValue(line.hourlyRate, "labor rate"),
      complimentary: Boolean(line.complimentary),
      shopSuppliesEligible: line.shopSuppliesEligible !== false,
    };
  });

  const cloned = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${membership.shopId}))`;
    const shop = await transaction.shop.update({
      where: { id: membership.shopId },
      data: { nextRepairOrderNumber: { increment: 1 } },
      select: {
        nextRepairOrderNumber: true,
        shopSuppliesEnabled: true,
        shopSuppliesRate: true,
        shopSuppliesCap: true,
        shopSuppliesTaxable: true,
      },
    });
    const repairOrderNumber = shop.nextRepairOrderNumber - 1;

    const created = await transaction.repairOrder.create({
      data: {
        shopId: membership.shopId,
        customerId,
        vehicleId,
        repairOrderNumber,
        status: "draft",
        odometer: snapshot.repairOrder?.odometer ?? null,
        customerComplaint: snapshot.repairOrder?.customerComplaint?.trim() || null,
        recommendation: snapshot.repairOrder?.recommendation?.trim() || null,
        shopSuppliesEnabledSnapshot: shop.shopSuppliesEnabled,
        shopSuppliesRateSnapshot: shop.shopSuppliesRate,
        shopSuppliesCapSnapshot: shop.shopSuppliesCap,
        shopSuppliesTaxableSnapshot: shop.shopSuppliesTaxable,
      },
      select: { id: true },
    });

    if (parts.length) {
      await transaction.repairOrderPart.createMany({
        data: parts.map((part) => ({
          shopId: membership.shopId,
          repairOrderId: created.id,
          ...part,
          vendorId: null,
          legacyLineKey: `web:${randomUUID()}`,
        })),
      });
    }

    if (labor.length) {
      await transaction.repairOrderLabor.createMany({
        data: labor.map((line) => ({
          shopId: membership.shopId,
          repairOrderId: created.id,
          ...line,
          legacyLineKey: `web:${randomUUID()}`,
        })),
      });
    }

    await refreshRepairOrderTotals(transaction, membership.shopId, created.id);
    await writeAuditEntry(
      transaction,
      auditEntry(
        membership.shopId,
        user?.id,
        "repair_order_created_from_declined_estimate",
        "repair_order",
        created.id,
        {
          sourceRepairOrderId,
          sourceRepairOrderNumber: snapshot.repairOrder?.number ?? null,
          sourceAuthorizationEventId: record.eventId,
          sourceRevision: record.revision,
          sourceSnapshotSha256: record.snapshotSha256,
          sourceDeclinedAt: record.occurredAt.toISOString(),
        },
        {
          actorEmail: user?.email,
          actorRole: membership.role,
          entityLabel: `RO #${repairOrderNumber}`,
          entityHref: `/repair-orders/${created.id}`,
          contextSummary: `Created from declined estimate on RO #${snapshot.repairOrder?.number ?? "—"}, revision ${record.revision}`,
        },
      ),
      { category: "operational", enabled: membership.shop.auditLoggingEnabled },
    );

    return { id: created.id, repairOrderNumber };
  }, { isolationLevel: "Serializable" });

  revalidatePath("/repair-orders");
  revalidatePath(`/repair-orders/${sourceRepairOrderId}/authorization-evidence`);
  redirect(`/repair-orders/${cloned.id}?fromDeclinedRo=${encodeURIComponent(String(snapshot.repairOrder?.number ?? ""))}&fromRevision=${record.revision}`);
}
