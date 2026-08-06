"use server";

import { redirect } from "next/navigation";
import { customerPhoneForStorage } from "@/lib/customer-phone";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createCustomer(formData: FormData) {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = customerPhoneForStorage(String(formData.get("phone") ?? "").trim());
  const phone2 = customerPhoneForStorage(String(formData.get("phone2") ?? "").trim());
  const email = String(formData.get("email") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  if (!displayName || displayName.length > 200 || phone === undefined || phone2 === undefined || email.length > 254 || (email && !/^\S+@\S+\.\S+$/.test(email)) || addressLine1.length > 200 || city.length > 100 || state.length > 30 || postalCode.length > 20) {
    throw new Error("Invalid customer information.");
  }
  const { membership } = await requirePermission("edit_customer_vehicle");
  const customer = await prisma.customer.create({ data: { shopId: membership.shopId, displayName, phone, phone2, email: email || null, addressLine1: addressLine1 || null, city: city || null, state: state || null, postalCode: postalCode || null }, select: { id: true } });
  redirect(`/customers/${customer.id}`);
}

export async function createVehicle(formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "");
  const year = Number(formData.get("year"));
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const licensePlate = String(formData.get("licensePlate") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim();
  const odometerText = String(formData.get("odometer") ?? "").trim();
  const odometer = odometerText ? Number(odometerText) : null;
  if (!UUID.test(customerId) || !Number.isInteger(year) || year < 1886 || year > new Date().getFullYear() + 1 || !make || make.length > 100 || !model || model.length > 100 || licensePlate.length > 30 || vin.length > 50 || (odometer !== null && (!Number.isInteger(odometer) || odometer < 0 || odometer > 10_000_000))) throw new Error("Invalid vehicle information.");
  const { membership } = await requirePermission("edit_customer_vehicle");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId: membership.shopId, archivedAt: null }, select: { id: true } });
  if (!customer) throw new Error("Select an active customer.");
  if (vin) {
    const conflict = await prisma.vehicle.findFirst({ where: { shopId: membership.shopId, vin: { equals: vin, mode: "insensitive" } }, select: { archivedAt: true, customer: { select: { archivedAt: true } } } });
    if (conflict) throw new Error(conflict.archivedAt || conflict.customer.archivedAt ? "An archived vehicle already uses this VIN. Restore that vehicle instead." : "A vehicle already uses this VIN.");
  }
  const vehicle = await prisma.vehicle.create({ data: { shopId: membership.shopId, customerId, year, make, model, licensePlate: licensePlate || null, vin: vin || null, odometer }, select: { id: true } });
  redirect(`/vehicles/${vehicle.id}`);
}
