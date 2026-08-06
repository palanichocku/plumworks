"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function lifecycleAccess(ownerOnly = false) {
  const access = await getCurrentMembership();
  if (!access.membership || (ownerOnly ? access.membership.role !== "OWNER" : access.membership.role === "STAFF")) throw new Error("You do not have permission to perform this action.");
  return access.membership;
}

const activeWork: Prisma.RepairOrderWhereInput = { status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } };

export async function archiveCustomer(formData: FormData) {
  const id = String(formData.get("id") ?? ""); if (!UUID.test(id)) throw new Error("Invalid customer.");
  const membership = await lifecycleAccess();
  await prisma.$transaction(async (tx) => {
    const record = await tx.customer.findFirst({ where: { id, shopId: membership.shopId }, select: { id: true, repairOrders: { where: activeWork, select: { id: true }, take: 1 } } });
    if (!record) throw new Error("Customer was not found.");
    if (record.repairOrders.length) throw new Error("Complete or cancel the active Repair Order before archiving this customer.");
    await tx.customer.update({ where: { id }, data: { archivedAt: new Date() } });
  });
  revalidatePath("/customers"); revalidatePath(`/customers/${id}`); redirect(`/customers/${id}`);
}

export async function restoreCustomer(formData: FormData) {
  const id = String(formData.get("id") ?? ""); if (!UUID.test(id)) throw new Error("Invalid customer.");
  const membership = await lifecycleAccess();
  const result = await prisma.customer.updateMany({ where: { id, shopId: membership.shopId }, data: { archivedAt: null } });
  if (result.count !== 1) throw new Error("Customer was not found.");
  revalidatePath("/customers"); redirect(`/customers/${id}`);
}

export async function archiveVehicle(formData: FormData) {
  const id = String(formData.get("id") ?? ""); if (!UUID.test(id)) throw new Error("Invalid vehicle.");
  const membership = await lifecycleAccess();
  await prisma.$transaction(async (tx) => {
    const record = await tx.vehicle.findFirst({ where: { id, shopId: membership.shopId }, select: { id: true, repairOrders: { where: activeWork, select: { id: true }, take: 1 } } });
    if (!record) throw new Error("Vehicle was not found.");
    if (record.repairOrders.length) throw new Error("Complete or cancel the active Repair Order before archiving this vehicle.");
    await tx.vehicle.update({ where: { id }, data: { archivedAt: new Date() } });
  });
  revalidatePath("/vehicles"); redirect(`/vehicles/${id}`);
}

export async function restoreVehicle(formData: FormData) {
  const id = String(formData.get("id") ?? ""); if (!UUID.test(id)) throw new Error("Invalid vehicle.");
  const membership = await lifecycleAccess();
  const result = await prisma.vehicle.updateMany({ where: { id, shopId: membership.shopId }, data: { archivedAt: null } });
  if (result.count !== 1) throw new Error("Vehicle was not found.");
  revalidatePath("/vehicles"); redirect(`/vehicles/${id}`);
}

export async function deleteCustomerPermanently(formData: FormData) {
  const id = String(formData.get("id") ?? ""); if (!UUID.test(id) || formData.get("confirmation") !== "DELETE") throw new Error("Type DELETE to confirm permanent deletion.");
  const membership = await lifecycleAccess(true);
  try {
    await prisma.$transaction(async (tx) => {
      const record = await tx.customer.findFirst({ where: { id, shopId: membership.shopId }, select: { id: true, legacyCustno: true, legacySourceTable: true, _count: { select: { vehicles: true, repairOrders: true, invoices: true, payments: true, accountsReceivable: true, legacyAliases: true } } } });
      if (!record) throw new Error("Customer was not found.");
      if (record.legacyCustno || record.legacySourceTable || Object.values(record._count).some(Boolean)) throw new Error("Permanent deletion is unavailable because this customer has vehicles, history, financial records, or legacy lineage. Archive it instead.");
      await tx.customer.delete({ where: { id } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new Error("A related record now protects this customer. Nothing was deleted.");
    throw error;
  }
  revalidatePath("/customers"); redirect("/customers");
}

export async function deleteVehiclePermanently(formData: FormData) {
  const id = String(formData.get("id") ?? ""); if (!UUID.test(id) || formData.get("confirmation") !== "DELETE") throw new Error("Type DELETE to confirm permanent deletion.");
  const membership = await lifecycleAccess(true);
  try {
    await prisma.$transaction(async (tx) => {
      const record = await tx.vehicle.findFirst({ where: { id, shopId: membership.shopId }, select: { id: true, legacyCarno: true, legacySourceTable: true, _count: { select: { repairOrders: true, invoices: true } } } });
      if (!record) throw new Error("Vehicle was not found.");
      if (record.legacyCarno || record.legacySourceTable || record._count.repairOrders || record._count.invoices) throw new Error("Permanent deletion is unavailable because this vehicle has service history or legacy lineage. Archive it instead.");
      await tx.vehicle.delete({ where: { id } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new Error("A related record now protects this vehicle. Nothing was deleted.");
    throw error;
  }
  revalidatePath("/vehicles"); redirect("/vehicles");
}
