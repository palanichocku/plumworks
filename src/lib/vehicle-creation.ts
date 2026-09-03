import "server-only";
import { prisma } from "@/lib/prisma";
import { vehicleEngineForStorage } from "@/lib/vehicle-fields";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createVehicleForShop(shopId: string, formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "");
  const year = Number(formData.get("year"));
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const engine = vehicleEngineForStorage(formData.get("engine"));
  const licensePlate = String(formData.get("licensePlate") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim();
  const odometerText = String(formData.get("odometer") ?? "").trim();
  const odometer = odometerText ? Number(odometerText) : null;
  if (!UUID.test(customerId) || !Number.isInteger(year) || year < 1886 || year > new Date().getFullYear() + 1 || !make || make.length > 100 || !model || model.length > 100 || engine === undefined || licensePlate.length > 30 || vin.length > 50 || (odometer !== null && (!Number.isInteger(odometer) || odometer < 0 || odometer > 10_000_000))) throw new Error("Invalid vehicle information.");

  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId, archivedAt: null }, select: { id: true, displayName: true } });
  if (!customer) throw new Error("Select an active customer.");
  if (vin) {
    const conflict = await prisma.vehicle.findFirst({ where: { shopId, vin: { equals: vin, mode: "insensitive" } }, select: { archivedAt: true, customerId: true, customer: { select: { archivedAt: true } } } });
    if (conflict) throw new Error(conflict.archivedAt || conflict.customer.archivedAt ? "An archived vehicle already uses this VIN. Restore that vehicle instead." : conflict.customerId === customerId ? "This customer already has a vehicle with that VIN. Select the existing vehicle instead." : "A vehicle already uses this VIN.");
  }
  return prisma.vehicle.create({ data: { shopId, customerId, year, make, model, engine, licensePlate: licensePlate || null, vin: vin || null, odometer }, select: { id: true, customerId: true, year: true, make: true, model: true, engine: true, vin: true, licensePlate: true, odometer: true, notes: true, customer: { select: { displayName: true } } } });
}
