"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";
import { refreshRepairOrderTotals } from "@/lib/repair-order-totals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function laborValues(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  const hours = Number(formData.get("hours"));
  const hourlyRate = Number(formData.get("hourlyRate"));
  if (
    !description || description.length > 500 || !Number.isFinite(hours) ||
    hours <= 0 || hours > 1000 || !Number.isFinite(hourlyRate) ||
    hourlyRate < 0 || hourlyRate > 1_000_000
  ) {
    throw new Error("Invalid labor line.");
  }
  return { description, hours: hours.toFixed(2), hourlyRate: hourlyRate.toFixed(2) };
}

async function editableOrder(shopId: string, repairOrderId: string) {
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  const order = await prisma.repairOrder.findFirst({
    where: { id: repairOrderId, shopId, status: { in: ["draft", "open"] }, legacySourceTable: null },
    select: { id: true },
  });
  if (!order) throw new Error("Repair order is not editable.");
  return order;
}

export async function addLaborLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const values = laborValues(formData);
  const { membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    await transaction.repairOrderLabor.create({
      data: {
        shopId: membership.shopId,
        repairOrderId,
        ...values,
        legacyLineKey: `web:${randomUUID()}`,
      },
    });
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function addCannedServiceLaborLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  if (!UUID.test(serviceId)) throw new Error("Invalid canned service.");
  const { membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const service = await transaction.cannedService.findFirst({
      where: { id: serviceId, shopId: membership.shopId, active: true },
      select: { description: true, defaultHours: true, defaultLaborRate: true },
    });
    if (!service) throw new Error("Canned service is unavailable.");
    await transaction.repairOrderLabor.create({
      data: {
        shopId: membership.shopId,
        repairOrderId,
        description: service.description,
        hours: service.defaultHours,
        hourlyRate: service.defaultLaborRate,
        legacyLineKey: `web:${randomUUID()}`,
      },
    });
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function updateLaborLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const laborLineId = String(formData.get("laborLineId") ?? "");
  const values = laborValues(formData);
  if (!UUID.test(laborLineId)) throw new Error("Invalid labor line.");
  const { membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderLabor.updateMany({
      where: { id: laborLineId, repairOrderId, shopId: membership.shopId },
      data: values,
    });
    if (result.count !== 1) throw new Error("Labor line is not editable.");
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function deleteLaborLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const laborLineId = String(formData.get("laborLineId") ?? "");
  if (!UUID.test(laborLineId)) throw new Error("Invalid labor line.");
  const { membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderLabor.deleteMany({
      where: { id: laborLineId, repairOrderId, shopId: membership.shopId },
    });
    if (result.count !== 1) throw new Error("Labor line is not editable.");
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}
