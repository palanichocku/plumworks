"use server";

import { redirect } from "next/navigation";
import { auditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function updateVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const year = Number(formData.get("year"));
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const licensePlate = String(formData.get("licensePlate") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim();
  const odometerText = String(formData.get("odometer") ?? "").trim();
  const odometer = odometerText ? Number(odometerText) : null;
  const maximumYear = new Date().getFullYear() + 1;
  if (!UUID.test(vehicleId) || !Number.isInteger(year) || year < 1886 ||
    year > maximumYear || !make || make.length > 100 || !model ||
    model.length > 100 || licensePlate.length > 30 || vin.length > 50 ||
    (odometer !== null && (!Number.isInteger(odometer) || odometer < 0 || odometer > 10_000_000))) {
    throw new Error("Invalid vehicle information.");
  }
  const { user, membership } = await requirePermission("edit_customer_vehicle");
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.vehicle.updateMany({
      where: { id: vehicleId, shopId: membership.shopId },
      data: { year, make, model, licensePlate: licensePlate || null, vin: vin || null, odometer },
    });
    if (result.count !== 1) throw new Error("Vehicle was not found.");
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "vehicle_updated", "vehicle", vehicleId, { source: "web" }) });
  });
  redirect(`/vehicles/${vehicleId}`);
}
