"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

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
      status: "draft",
      legacySourceTable: null,
    },
    select: { id: true },
  });
  if (!order) throw new Error("Repair order is not editable.");
}

async function refreshPartsTotal(
  transaction: Prisma.TransactionClient,
  shopId: string,
  repairOrderId: string,
) {
  const [order, lines] = await Promise.all([
    transaction.repairOrder.findFirstOrThrow({
      where: {
        id: repairOrderId,
        shopId,
        status: "draft",
        legacySourceTable: null,
      },
      select: { laborTotal: true, taxTotal: true },
    }),
    transaction.repairOrderPart.findMany({
      where: { repairOrderId, shopId },
      select: { quantity: true, unitPrice: true },
    }),
  ]);
  const partsTotal = lines.reduce(
    (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice),
    0,
  );
  await transaction.repairOrder.update({
    where: { id: repairOrderId },
    data: {
      partsTotal: partsTotal.toFixed(2),
      estimatedTotal: (
        partsTotal + Number(order.laborTotal) + Number(order.taxTotal)
      ).toFixed(2),
    },
  });
}

export async function addPartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const values = partValues(formData);
  const { membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    await transaction.repairOrderPart.create({
      data: {
        shopId: membership.shopId,
        repairOrderId,
        ...values,
        legacyLineKey: `web:${randomUUID()}`,
      },
    });
    await refreshPartsTotal(transaction, membership.shopId, repairOrderId);
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function updatePartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const partLineId = String(formData.get("partLineId") ?? "");
  const values = partValues(formData);
  if (!UUID.test(partLineId)) throw new Error("Invalid part line.");
  const { membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderPart.updateMany({
      where: { id: partLineId, repairOrderId, shopId: membership.shopId },
      data: values,
    });
    if (result.count !== 1) throw new Error("Part line is not editable.");
    await refreshPartsTotal(transaction, membership.shopId, repairOrderId);
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function deletePartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const partLineId = String(formData.get("partLineId") ?? "");
  if (!UUID.test(partLineId)) throw new Error("Invalid part line.");
  const { membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderPart.deleteMany({
      where: { id: partLineId, repairOrderId, shopId: membership.shopId },
    });
    if (result.count !== 1) throw new Error("Part line is not editable.");
    await refreshPartsTotal(transaction, membership.shopId, repairOrderId);
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}
