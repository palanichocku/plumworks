"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function updateInvoiceSettings(formData: FormData) {
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");

  const taxRateText = String(formData.get("defaultTaxRate") ?? "").trim();
  const taxPercent = new Prisma.Decimal(taxRateText || "0");
  const laborRate = new Prisma.Decimal(String(formData.get("defaultLaborRate") ?? "0"));
  if (!taxPercent.isFinite() || taxPercent.isNegative() || taxPercent.greaterThan(100)) {
    throw new Error("Default tax rate must be between 0 and 100.");
  }
  if (!laborRate.isFinite() || laborRate.isNegative() || laborRate.greaterThan(1_000_000)) {
    throw new Error("Default labor rate is invalid.");
  }

  const invoiceFooterMessage = optionalText(formData.get("invoiceFooterMessage"));
  const warrantyText = optionalText(formData.get("warrantyText"));
  if ((invoiceFooterMessage?.length ?? 0) > 2000 || (warrantyText?.length ?? 0) > 4000) {
    throw new Error("Invoice settings text is too long.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.shop.update({
      where: { id: membership.shopId },
      data: { defaultTaxRate: taxPercent.div(100).toDecimalPlaces(5), defaultLaborRate: laborRate.toDecimalPlaces(2), partsTaxable: formData.get("partsTaxable") === "on", laborTaxable: formData.get("laborTaxable") === "on", invoiceFooterMessage, warrantyText },
    });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "shop_settings_updated", "shop", membership.shopId, { source: "web" }) });
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
