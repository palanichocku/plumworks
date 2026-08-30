"use server";

import { redirect } from "next/navigation";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { customerPhoneForStorage } from "@/lib/customer-phone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function updateCustomer(formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const phone2 = String(formData.get("phone2") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  if (!UUID.test(customerId) || !displayName || displayName.length > 200 ||
    phone.length > 40 || phone2.length > 40 || email.length > 254 ||
    (email && !/^\S+@\S+\.\S+$/.test(email)) || addressLine1.length > 200 ||
    city.length > 100 || state.length > 30 || postalCode.length > 20) {
    throw new Error("Invalid customer information.");
  }
  const { user, membership } = await requirePermission("edit_customer_vehicle");
  const existing = await prisma.customer.findFirst({
    where: { id: customerId, shopId: membership.shopId, archivedAt: null },
    select: { phone: true, phone2: true },
  });
  if (!existing) throw new Error("Customer was not found.");
  const storedPhone = phone === (existing.phone ?? "") ? existing.phone : customerPhoneForStorage(phone);
  const storedPhone2 = phone2 === (existing.phone2 ?? "") ? existing.phone2 : customerPhoneForStorage(phone2);
  if (storedPhone === undefined || storedPhone2 === undefined) throw new Error("Enter a complete 10-digit phone number.");
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.customer.updateMany({
      where: { id: customerId, shopId: membership.shopId, archivedAt: null },
      data: { displayName, phone: storedPhone, phone2: storedPhone2, email: email || null, addressLine1: addressLine1 || null, city: city || null, state: state || null, postalCode: postalCode || null },
    });
    if (result.count !== 1) throw new Error("Customer was not found.");
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "customer_updated", "customer", customerId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: displayName, entityHref: `/customers/${customerId}`, contextSummary: "Customer record updated" }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
  });
  redirect(`/customers/${customerId}`);
}
