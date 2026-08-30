"use server";

import { revalidatePath } from "next/cache";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contexts = new Set(["vehicle", "customer", "repair-order"]);

export async function updateVehicleLicensePlate(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const context = String(formData.get("context") ?? "");
  const contextId = String(formData.get("contextId") ?? "");
  const licensePlate = String(formData.get("licensePlate") ?? "").trim();
  if (!UUID.test(vehicleId) || !UUID.test(contextId) || !contexts.has(context) || licensePlate.length > 30) {
    throw new Error("Invalid license plate update.");
  }

  const { user, membership } = await requirePermission("edit_customer_vehicle");
  await prisma.$transaction(async (transaction) => {
    const vehicle = await transaction.vehicle.findFirst({
      where: { id: vehicleId, shopId: membership.shopId, archivedAt: null, customer: { shopId: membership.shopId, archivedAt: null } },
      select: { id: true, customerId: true, licensePlate: true, year: true, make: true, model: true },
    });
    if (!vehicle) throw new Error("Active vehicle was not found.");

    if (context === "vehicle" && contextId !== vehicle.id) throw new Error("Vehicle context does not match.");
    if (context === "customer" && contextId !== vehicle.customerId) throw new Error("Customer and vehicle do not match.");
    if (context === "repair-order") {
      const order = await transaction.repairOrder.findFirst({
        where: { id: contextId, shopId: membership.shopId, vehicleId, status: { in: ["draft", "open"] }, invoices: { none: {} } },
        select: { id: true },
      });
      if (!order) throw new Error("Editable Repair Order and vehicle do not match.");
    }

    const storedPlate = licensePlate || null;
    if (vehicle.licensePlate === storedPlate) return;
    const result = await transaction.vehicle.updateMany({
      where: { id: vehicle.id, shopId: membership.shopId, licensePlate: vehicle.licensePlate },
      data: { licensePlate: storedPlate },
    });
    if (result.count !== 1) throw new Error("Vehicle changed while the license plate was being saved.");
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "vehicle_license_plate_updated", "vehicle", vehicle.id, { source: context }, {
        actorEmail: user?.email,
        actorRole: membership.role,
        entityLabel: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
        entityHref: `/vehicles/${vehicle.id}`,
        contextSummary: "Vehicle license plate updated",
      }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
  });

  revalidatePath(`/vehicles/${vehicleId}`);
  if (context === "customer") revalidatePath(`/customers/${contextId}`);
  if (context === "repair-order") revalidatePath(`/repair-orders/${contextId}`);
}
