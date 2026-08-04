"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ComplimentaryServiceActionState = { status: "idle" | "success" | "error"; message?: string };

function values(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  if (!description || description.length > 500) throw new Error("Invalid complimentary service.");
  return { description, hours: "0.00", hourlyRate: "0.00", complimentary: true } as const;
}

async function editableOrder(shopId: string, repairOrderId: string) {
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  return prisma.repairOrder.findFirstOrThrow({
    where: { id: repairOrderId, shopId, status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } },
    select: { repairOrderNumber: true },
  });
}

export async function addComplimentaryService(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const data = values(formData);
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const order = await editableOrder(membership.shopId, repairOrderId);
  await prisma.$transaction(async (transaction) => {
    const line = await transaction.repairOrderLabor.create({ data: { shopId: membership.shopId, repairOrderId, ...data, legacyLineKey: `web:${randomUUID()}` }, select: { id: true } });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "complimentary_service_added", "repair_order_labor", line.id, { complimentary: true }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${repairOrderId}`, contextSummary: "Complimentary service added" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function updateComplimentaryService(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const laborLineId = String(formData.get("laborLineId") ?? "");
  if (!UUID.test(laborLineId)) throw new Error("Invalid complimentary service.");
  const data = values(formData);
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const order = await editableOrder(membership.shopId, repairOrderId);
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderLabor.updateMany({ where: { id: laborLineId, repairOrderId, shopId: membership.shopId, complimentary: true }, data });
    if (result.count !== 1) throw new Error("Complimentary service is not editable.");
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "complimentary_service_updated", "repair_order_labor", laborLineId, { complimentary: true }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${repairOrderId}`, contextSummary: "Complimentary service updated" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function deleteComplimentaryService(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const laborLineId = String(formData.get("laborLineId") ?? "");
  if (!UUID.test(laborLineId)) throw new Error("Invalid complimentary service.");
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const order = await editableOrder(membership.shopId, repairOrderId);
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderLabor.deleteMany({ where: { id: laborLineId, repairOrderId, shopId: membership.shopId, complimentary: true } });
    if (result.count !== 1) throw new Error("Complimentary service is not editable.");
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "complimentary_service_deleted", "repair_order_labor", laborLineId, { complimentary: true }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${repairOrderId}`, contextSummary: "Complimentary service deleted" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

async function result(action: (formData: FormData) => Promise<void>, formData: FormData): Promise<ComplimentaryServiceActionState> {
  try { await action(formData); return { status: "success" }; }
  catch { return { status: "error", message: "The complimentary service could not be saved. Check the description and try again." }; }
}

export async function addComplimentaryServiceWithState(_state: ComplimentaryServiceActionState, formData: FormData) { return result(addComplimentaryService, formData); }
export async function updateComplimentaryServiceWithState(_state: ComplimentaryServiceActionState, formData: FormData) { return result(updateComplimentaryService, formData); }
