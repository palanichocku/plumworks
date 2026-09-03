"use server";

import { redirect } from "next/navigation";
import { customerPhoneForStorage } from "@/lib/customer-phone";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { createVehicleForShop } from "@/lib/vehicle-creation";

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
  const { membership } = await requirePermission("edit_customer_vehicle");
  const vehicle = await createVehicleForShop(membership.shopId, formData);
  redirect(`/vehicles/${vehicle.id}`);
}
