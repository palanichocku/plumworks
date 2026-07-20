"use server";

import { revalidatePath } from "next/cache";
import { auditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { canEditInternalNotes, normalizeInternalNotes } from "@/lib/internal-notes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type InternalNotesState = { status: "idle" | "success" | "error"; message?: string };

async function access() {
  const result = await requirePermission("edit_customer_vehicle");
  if (!canEditInternalNotes(result.membership.role)) throw new Error("You do not have permission to edit internal notes.");
  return result;
}

export async function updateCustomerNotes(_state: InternalNotesState, formData: FormData): Promise<InternalNotesState> {
  const customerId = String(formData.get("recordId") ?? "");
  const parsed = normalizeInternalNotes(formData.get("notes"));
  if (!UUID.test(customerId)) return { status: "error", message: "Invalid customer." };
  if (parsed.error) return { status: "error", message: parsed.error };
  const { user, membership } = await access();
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.customer.updateMany({ where: { id: customerId, shopId: membership.shopId }, data: { notes: parsed.notes } });
    if (result.count !== 1) return false;
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "customer_notes_updated", "customer", customerId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: "Customer internal notes", entityHref: `/customers/${customerId}`, contextSummary: "Customer internal notes updated" }) });
    return true;
  });
  if (!updated) return { status: "error", message: "Customer was not found." };
  revalidatePath(`/customers/${customerId}`);
  return { status: "success" };
}

export async function updateVehicleNotes(_state: InternalNotesState, formData: FormData): Promise<InternalNotesState> {
  const vehicleId = String(formData.get("recordId") ?? "");
  const parsed = normalizeInternalNotes(formData.get("notes"));
  if (!UUID.test(vehicleId)) return { status: "error", message: "Invalid vehicle." };
  if (parsed.error) return { status: "error", message: parsed.error };
  const { user, membership } = await access();
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.vehicle.updateMany({ where: { id: vehicleId, shopId: membership.shopId }, data: { notes: parsed.notes } });
    if (result.count !== 1) return false;
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "vehicle_notes_updated", "vehicle", vehicleId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: "Vehicle internal notes", entityHref: `/vehicles/${vehicleId}`, contextSummary: "Vehicle internal notes updated" }) });
    return true;
  });
  if (!updated) return { status: "error", message: "Vehicle was not found." };
  revalidatePath(`/vehicles/${vehicleId}`);
  return { status: "success" };
}
