"use server";
import { revalidatePath } from "next/cache";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { operationalRepairOrderWhere } from "@/lib/repair-order-lifecycle";
import { normalizeRepairOrderCustomerQuery } from "@/lib/repair-order-customer-search";
import { createVehicleForShop } from "@/lib/vehicle-creation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type VehicleSearchResult = { id: string; customerId: string; year: number | null; make: string | null; model: string | null; engine: string | null; vin: string | null; licensePlate: string | null; odometer: number | null; notes: string | null; customer: { displayName: string } };

export async function searchRepairOrderVehicles(value: string): Promise<VehicleSearchResult[]> {
  const query = normalizeRepairOrderCustomerQuery(value); if (!query) return [];
  const { membership } = await requirePermission("edit_draft_repair_order");
  const year = /^\d{4}$/.test(query) ? Number(query) : undefined;
  return prisma.vehicle.findMany({ where: { shopId: membership.shopId, archivedAt: null, customer: { archivedAt: null }, OR: [
    ...(year ? [{ year }] : []), { make: { contains: query, mode: "insensitive" } }, { model: { contains: query, mode: "insensitive" } },
    { vin: { contains: query, mode: "insensitive" } }, { licensePlate: { contains: query, mode: "insensitive" } },
    { customer: { displayName: { contains: query, mode: "insensitive" } } },
  ] }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 15, select: { id: true, customerId: true, year: true, make: true, model: true, engine: true, vin: true, licensePlate: true, odometer: true, notes: true, customer: { select: { displayName: true } } } });
}

export async function getRepairOrderCustomerVehicles(customerId: string): Promise<VehicleSearchResult[]> {
  if (!UUID.test(customerId)) return [];
  const { membership } = await requirePermission("edit_draft_repair_order");
  return prisma.vehicle.findMany({
    where: { shopId: membership.shopId, customerId, archivedAt: null, customer: { archivedAt: null } },
    orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }, { id: "desc" }],
    select: { id: true, customerId: true, year: true, make: true, model: true, engine: true, vin: true, licensePlate: true, odometer: true, notes: true, customer: { select: { displayName: true } } },
  });
}

export type ReassignRepairOrderState = { status: "idle" | "success" | "error"; message?: string; mileageCleared?: boolean };
export type InlineVehicleCreateState = { status: "success"; vehicle: VehicleSearchResult } | { status: "error"; message: string };

export async function createRepairOrderCorrectionVehicle(formData: FormData): Promise<InlineVehicleCreateState> {
  const { membership } = await requirePermission("edit_customer_vehicle");
  try { return { status: "success", vehicle: await createVehicleForShop(membership.shopId, formData) }; }
  catch (error) { return { status: "error", message: error instanceof Error ? error.message : "Unable to create the vehicle." }; }
}

export async function reassignRepairOrder(_state: ReassignRepairOrderState, formData: FormData): Promise<ReassignRepairOrderState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? ""), customerId = String(formData.get("customerId") ?? ""), vehicleId = String(formData.get("vehicleId") ?? "");
  const expectedCustomerId = String(formData.get("expectedCustomerId") ?? ""), expectedVehicleId = String(formData.get("expectedVehicleId") ?? "");
  if (![repairOrderId, customerId, vehicleId, expectedCustomerId, expectedVehicleId].every((id) => UUID.test(id))) return { status: "error", message: "Invalid customer or vehicle selection." };
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM repair_orders WHERE id = ${repairOrderId}::uuid AND shop_id = ${membership.shopId}::uuid FOR UPDATE`;
      const order = await transaction.repairOrder.findFirst({ where: { id: repairOrderId, ...operationalRepairOrderWhere(membership.shopId) }, select: { id: true, customerId: true, vehicleId: true, repairOrderNumber: true } });
      if (!order) {
        const invoiced = await transaction.repairOrder.findFirst({ where: { id: repairOrderId, shopId: membership.shopId, invoices: { some: {} } }, select: { id: true } });
        throw new Error(invoiced ? "Customer and vehicle cannot be changed because this Repair Order has already been invoiced." : "This Repair Order is no longer editable.");
      }
      if (order.customerId !== expectedCustomerId || order.vehicleId !== expectedVehicleId) throw new Error("This Repair Order changed while the dialog was open. Review it and try again.");
      const [customer, vehicle] = await Promise.all([
        transaction.customer.findFirst({ where: { id: customerId, shopId: membership.shopId, archivedAt: null }, select: { id: true } }),
        transaction.vehicle.findFirst({ where: { id: vehicleId, shopId: membership.shopId, archivedAt: null, customer: { archivedAt: null } }, select: { id: true, customerId: true } }),
      ]);
      if (!customer) throw new Error("The selected customer is not available for this Shop.");
      if (!vehicle) throw new Error("The selected vehicle is not available for this Shop.");
      const vehicleChanged = vehicleId !== order.vehicleId, customerChanged = customerId !== order.customerId;
      if (!vehicleChanged && !customerChanged) return { vehicleChanged: false, customerChanged: false };
      if (vehicle.customerId !== customerId) throw new Error("The selected vehicle does not belong to the selected customer.");
      await transaction.repairOrder.update({ where: { id: order.id }, data: { customerId, vehicleId, ...(vehicleChanged ? { odometer: null } : {}) } });
      const changes: Record<string, { from: string; to: string }> = {};
      if (customerChanged) changes.customerId = { from: order.customerId, to: customerId }; if (vehicleChanged) changes.vehicleId = { from: order.vehicleId, to: vehicleId };
      await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "repair_order_assignment_corrected", "repair_order", order.id, { changes }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${order.id}`, contextSummary: "Repair order customer/vehicle assignment corrected" }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
      return { vehicleChanged, customerChanged };
    }, { isolationLevel: "Serializable" });
    revalidatePath(`/repair-orders/${repairOrderId}`); revalidatePath("/repair-orders"); revalidatePath(`/customers/${customerId}`); revalidatePath(`/vehicles/${vehicleId}`);
    return { status: "success", mileageCleared: result.vehicleChanged, message: result.vehicleChanged ? `Repair Order ${result.customerChanged ? "customer and vehicle" : "vehicle"} updated. Vehicle changed. Enter the mileage for the replacement vehicle.` : "Repair Order customer updated." };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "Unable to update this Repair Order." }; }
}
