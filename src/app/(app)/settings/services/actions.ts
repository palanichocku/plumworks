"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function values(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const defaultHours = new Prisma.Decimal(String(formData.get("defaultHours") ?? ""));
  const defaultLaborRate = new Prisma.Decimal(String(formData.get("defaultLaborRate") ?? ""));
  if (!name || name.length > 100 || !description || description.length > 500 || !defaultHours.isFinite() || defaultHours.lte(0) || defaultHours.gt(1000) || !defaultLaborRate.isFinite() || defaultLaborRate.lt(0) || defaultLaborRate.gt(1_000_000)) {
    throw new Error("Invalid canned service.");
  }
  return { name, description, defaultHours: defaultHours.toDecimalPlaces(2), defaultLaborRate: defaultLaborRate.toDecimalPlaces(2), active: formData.get("active") === "on" };
}

export async function createCannedService(formData: FormData) {
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await prisma.$transaction(async (transaction) => {
    const service = await transaction.cannedService.create({ data: { shopId: membership.shopId, ...values(formData) }, select: { id: true } });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "canned_service_created", "canned_service", service.id, { source: "web" }) });
  });
  revalidatePath("/settings/services");
}

export async function updateCannedService(formData: FormData) {
  const id = String(formData.get("serviceId") ?? "");
  if (!UUID.test(id)) throw new Error("Invalid canned service.");
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  const data = values(formData);
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.cannedService.updateMany({ where: { id, shopId: membership.shopId }, data });
    if (result.count !== 1) throw new Error("Canned service was not found.");
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, data.active ? "canned_service_updated" : "canned_service_deactivated", "canned_service", id, { active: data.active }) });
  });
  revalidatePath("/settings/services");
}

export async function deleteCannedService(formData: FormData) {
  const id = String(formData.get("serviceId") ?? "");
  if (!UUID.test(id)) throw new Error("Invalid canned service.");
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.cannedService.deleteMany({ where: { id, shopId: membership.shopId } });
    if (result.count === 1) await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "canned_service_deleted", "canned_service", id, { source: "web" }) });
  });
  revalidatePath("/settings/services");
}
