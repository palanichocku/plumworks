"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { normalizeLeadNotificationEmail } from "@/lib/marketing-lead-notification-settings";
import { prisma } from "@/lib/prisma";

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const MAX_SIGNATURE_BYTES = 750 * 1024;

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function validateOptionalSignatureData(value: FormDataEntryValue | null) {
  const dataUrl = String(value ?? "").trim();
  if (!dataUrl) return null;
  const match = PNG_DATA_URL.exec(dataUrl);
  if (!match) throw new Error("Default shop representative signature is invalid.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 100) throw new Error("Default shop representative signature is too small.");
  if (bytes.length > MAX_SIGNATURE_BYTES) throw new Error("Default shop representative signature is too large.");
  return {
    dataUrl,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
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
  const defaultShopRepresentativeSignature = validateOptionalSignatureData(formData.get("defaultShopRepresentativeSignatureData"));
  const auditLoggingEnabled = formData.get("auditLoggingEnabled") === "on";
  if ((invoiceFooterMessage?.length ?? 0) > 2000 || [warrantyText, invoicePartsWarrantyText, invoiceAuthorizationText, invoiceCertificationText].some((value) => (value?.length ?? 0) > 4000) || [repairFacilityRegistrationNumber, defaultInvoiceTechnicianLicenseNumber].some((value) => (value?.length ?? 0) > 100) || [defaultAuthorizedRepresentative, defaultInvoiceTechnicianName].some((value) => (value?.length ?? 0) > 150)) {
    throw new Error("Invoice settings text is too long.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.shop.update({
      where: { id: membership.shopId },
      data: { defaultTaxRate: taxPercent.div(100).toDecimalPlaces(5), defaultLaborRate: laborRate.toDecimalPlaces(2), partsTaxable: formData.get("partsTaxable") === "on", laborTaxable: formData.get("laborTaxable") === "on", shopSuppliesEnabled: formData.get("shopSuppliesEnabled") === "on", shopSuppliesRate: shopSuppliesRatePercent.div(100).toDecimalPlaces(6), shopSuppliesCap: shopSuppliesCap.toDecimalPlaces(2), shopSuppliesTaxable: formData.get("shopSuppliesTaxable") === "on", auditLoggingEnabled, invoiceFooterMessage, warrantyText, invoicePartsWarrantyText, invoiceAuthorizationText, invoiceCertificationText, repairFacilityRegistrationNumber, defaultAuthorizedRepresentative, defaultInvoiceTechnicianName, defaultInvoiceTechnicianLicenseNumber },
    });

    if (defaultShopRepresentativeSignature) {
      await transaction.$executeRaw`
        INSERT INTO shop_signature_defaults (
          shop_id,
          representative_name,
          signature_data,
          signature_sha256,
          updated_by,
          updated_at
        ) VALUES (
          ${membership.shopId}::uuid,
          ${defaultAuthorizedRepresentative ?? "Subbu Veerappan"},
          ${defaultShopRepresentativeSignature.dataUrl},
          ${defaultShopRepresentativeSignature.sha256},
          ${user?.id ?? null}::uuid,
          NOW()
        )
        ON CONFLICT (shop_id) DO UPDATE SET
          representative_name = EXCLUDED.representative_name,
          signature_data = EXCLUDED.signature_data,
          signature_sha256 = EXCLUDED.signature_sha256,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      `;
    } else {
      await transaction.$executeRaw`
        DELETE FROM shop_signature_defaults
        WHERE shop_id = ${membership.shopId}::uuid
      `;
    }

    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "shop_settings_updated", "shop", membership.shopId, { source: "web", auditLoggingEnabled, defaultShopRepresentativeSignatureConfigured: Boolean(defaultShopRepresentativeSignature) }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: membership.shop.name, entityHref: "/admin/shop-settings", contextSummary: "Shop settings updated" }), { category: "governance" });
  });

  revalidatePath("/admin/shop-settings");
  revalidatePath("/repair-orders");
  revalidatePath("/invoices");
  redirect("/admin/shop-settings?saved=1");
}

export async function updateLeadNotificationSettings(_previous: { error?: string; saved?: boolean }, formData: FormData): Promise<{ error?: string; saved?: boolean }> {
  const { user, membership } = await requirePermission("edit_shop_settings");
  let emails;
  try {
    emails = {
      marketingLeadNotifyEmail1: normalizeLeadNotificationEmail(formData.get("marketingLeadNotifyEmail1")),
      marketingLeadNotifyEmail2: normalizeLeadNotificationEmail(formData.get("marketingLeadNotifyEmail2")),
    };
  } catch {
    return { error: "Enter valid notification email addresses, or leave them blank to use the existing email fallback." };
  }
  const data = {
    ...emails,
    marketingLeadInAppNotificationsEnabled: formData.get("marketingLeadInAppNotificationsEnabled") === "on",
    marketingLeadEmailNotificationsEnabled: formData.get("marketingLeadEmailNotificationsEnabled") === "on",
  };
  await prisma.$transaction(async (transaction) => {
    await transaction.shop.update({ where: { id: membership.shopId }, data });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "shop_settings_updated", "shop", membership.shopId,
      { source: "web", section: "lead_notifications" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: membership.shop.name, entityHref: "/admin/shop-settings", contextSummary: "Lead notification settings updated" }), { category: "governance" });
  });
  revalidatePath("/admin/shop-settings");
  return { saved: true };
}
