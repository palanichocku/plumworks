"use server";

import { redirect } from "next/navigation";
import { auditEntry } from "@/lib/audit";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function updateCustomer(formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  if (!UUID.test(customerId) || !displayName || displayName.length > 200 ||
    phone.length > 40 || email.length > 254 ||
    (email && !/^\S+@\S+\.\S+$/.test(email)) || addressLine1.length > 200 ||
    city.length > 100 || state.length > 30 || postalCode.length > 20) {
    throw new Error("Invalid customer information.");
  }
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.customer.updateMany({
      where: { id: customerId, shopId: membership.shopId },
      data: { displayName, phone: phone || null, email: email || null, addressLine1: addressLine1 || null, city: city || null, state: state || null, postalCode: postalCode || null },
    });
    if (result.count !== 1) throw new Error("Customer was not found.");
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "customer_updated", "customer", customerId, { source: "web" }) });
  });
  redirect(`/customers/${customerId}`);
}
