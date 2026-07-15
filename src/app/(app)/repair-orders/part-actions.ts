"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auditEntry } from "@/lib/audit";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";
import { refreshRepairOrderTotals } from "@/lib/repair-order-totals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function partValues(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  const quantity = Number(formData.get("quantity"));
  const unitPrice = Number(formData.get("unitPrice"));
  if (
    !description || description.length > 500 || !Number.isFinite(quantity) ||
    quantity <= 0 || quantity > 1_000_000 || !Number.isFinite(unitPrice) ||
    unitPrice < 0 || unitPrice > 1_000_000
  ) {
    throw new Error("Invalid part line.");
  }
  return {
    description,
    quantity: quantity.toFixed(2),
    unitPrice: unitPrice.toFixed(2),
  };
}

async function editableOrder(shopId: string, repairOrderId: string) {
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  const order = await prisma.repairOrder.findFirst({
    where: {
      id: repairOrderId,
      shopId,
      status: { in: ["draft", "open"] },
      legacySourceTable: null,
    },
    select: { id: true },
  });
  if (!order) throw new Error("Repair order is not editable.");
}

export async function addPartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const values = partValues(formData);
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const line = await transaction.repairOrderPart.create({
      data: {
        shopId: membership.shopId,
        repairOrderId,
        ...values,
        legacyLineKey: `web:${randomUUID()}`,
      },
      select: { id: true },
    });
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "part_line_added", "repair_order_part", line.id, { source: "web" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function updatePartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const partLineId = String(formData.get("partLineId") ?? "");
  const values = partValues(formData);
  if (!UUID.test(partLineId)) throw new Error("Invalid part line.");
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderPart.updateMany({
      where: { id: partLineId, repairOrderId, shopId: membership.shopId },
      data: values,
    });
    if (result.count !== 1) throw new Error("Part line is not editable.");
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "part_line_updated", "repair_order_part", partLineId, { source: "web" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function deletePartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const partLineId = String(formData.get("partLineId") ?? "");
  if (!UUID.test(partLineId)) throw new Error("Invalid part line.");
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderPart.deleteMany({
      where: { id: partLineId, repairOrderId, shopId: membership.shopId },
    });
    if (result.count !== 1) throw new Error("Part line is not editable.");
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "part_line_deleted", "repair_order_part", partLineId, { source: "web" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}
