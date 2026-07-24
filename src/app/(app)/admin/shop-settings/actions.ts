"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function updateInvoiceSettings(formData: FormData) {
  const { user, membership } = await requirePermission("edit_shop_settings");

  const taxRateText = String(formData.get("defaultTaxRate") ?? "").trim();
  const taxPercent = new Prisma.Decimal(taxRateText || "0");
  const laborRate = new Prisma.Decimal(String(formData.get("defaultLaborRate") ?? "0"));
  const shopSuppliesRatePercent = new Prisma.Decimal(String(formData.get("shopSuppliesRate") ?? "0"));
  const shopSuppliesCap = new Prisma.Decimal(String(formData.get("shopSuppliesCap") ?? "0"));
  if (!taxPercent.isFinite() || taxPercent.isNegative() || taxPercent.greaterThan(100)) {
    throw new Error("Default tax rate must be between 0 and 100.");
  }
  if (!laborRate.isFinite() || laborRate.isNegative() || laborRate.greaterThan(1_000_000)) {
    throw new Error("Default labor rate is invalid.");
  }
  if (!shopSuppliesRatePercent.isFinite() || shopSuppliesRatePercent.isNegative() || shopSuppliesRatePercent.greaterThan(100)) {
    throw new Error("Shop Supplies rate must be between 0 and 100.");
  }
  if (!shopSuppliesCap.isFinite() || shopSuppliesCap.isNegative() || shopSuppliesCap.greaterThan(1_000_000)) {
    throw new Error("Shop Supplies maximum charge is invalid.");
  }

  const invoiceFooterMessage = optionalText(formData.get("invoiceFooterMessage"));
  const warrantyText = optionalText(formData.get("warrantyText"));
  const invoicePartsWarrantyText = optionalText(formData.get("invoicePartsWarrantyText"));
  const invoiceAuthorizationText = optionalText(formData.get("invoiceAuthorizationText"));
  const invoiceCertificationText = optionalText(formData.get("invoiceCertificationText"));
  const repairFacilityRegistrationNumber = optionalText(formData.get("repairFacilityRegistrationNumber"));
  const defaultAuthorizedRepresentative = optionalText(formData.get("defaultAuthorizedRepresentative"));
  const defaultInvoiceTechnicianName = optionalText(formData.get("defaultInvoiceTechnicianName"));
  const defaultInvoiceTechnicianLicenseNumber = optionalText(formData.get("defaultInvoiceTechnicianLicenseNumber"));
  if ((invoiceFooterMessage?.length ?? 0) > 2000 || [warrantyText, invoicePartsWarrantyText, invoiceAuthorizationText, invoiceCertificationText].some((value) => (value?.length ?? 0) > 4000) || [repairFacilityRegistrationNumber, defaultInvoiceTechnicianLicenseNumber].some((value) => (value?.length ?? 0) > 100) || [defaultAuthorizedRepresentative, defaultInvoiceTechnicianName].some((value) => (value?.length ?? 0) > 150)) {
    throw new Error("Invoice settings text is too long.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.shop.update({
      where: { id: membership.shopId },
      data: { defaultTaxRate: taxPercent.div(100).toDecimalPlaces(5), defaultLaborRate: laborRate.toDecimalPlaces(2), partsTaxable: formData.get("partsTaxable") === "on", laborTaxable: formData.get("laborTaxable") === "on", shopSuppliesEnabled: formData.get("shopSuppliesEnabled") === "on", shopSuppliesRate: shopSuppliesRatePercent.div(100).toDecimalPlaces(6), shopSuppliesCap: shopSuppliesCap.toDecimalPlaces(2), shopSuppliesTaxable: true, invoiceFooterMessage, warrantyText, invoicePartsWarrantyText, invoiceAuthorizationText, invoiceCertificationText, repairFacilityRegistrationNumber, defaultAuthorizedRepresentative, defaultInvoiceTechnicianName, defaultInvoiceTechnicianLicenseNumber },
    });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "shop_settings_updated", "shop", membership.shopId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: membership.shop.name, entityHref: "/admin/shop-settings", contextSummary: "Shop settings updated" }) });
  });

  revalidatePath("/admin/shop-settings");
  revalidatePath("/repair-orders");
  redirect("/admin/shop-settings?saved=1");
}
