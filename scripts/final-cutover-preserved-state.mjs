import { readFile, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { resolveSingleShopId } from "./lib/single-shop.mjs";
import { configurationEvidence, preservedConfigurationDifferences, verifyRepairOrderSequence } from "./lib/final-cutover-preserved-state.mjs";

export const SHOP_SETTINGS_SELECT = Object.freeze({
  id: true,
  name: true,
  addressLine1: true,
  city: true,
  state: true,
  postalCode: true,
  phone: true,
  defaultTaxRate: true,
  defaultLaborRate: true,
  partsTaxable: true,
  laborTaxable: true,
  shopSuppliesEnabled: true,
  shopSuppliesRate: true,
  shopSuppliesCap: true,
  shopSuppliesTaxable: true,
  auditLoggingEnabled: true,
  marketingLeadInAppNotificationsEnabled: true,
  marketingLeadEmailNotificationsEnabled: true,
  marketingLeadNotifyEmail1: true,
  marketingLeadNotifyEmail2: true,
  invoiceFooterMessage: true,
  warrantyText: true,
  invoicePartsWarrantyText: true,
  invoiceAuthorizationText: true,
  invoiceCertificationText: true,
  repairFacilityRegistrationNumber: true,
  defaultAuthorizedRepresentative: true,
  defaultInvoiceTechnicianName: true,
  defaultInvoiceTechnicianLicenseNumber: true,
  nextRepairOrderNumber: true,
});

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

async function capture(prisma, shopId) {
  const [
    shop, memberships, invites, cannedServices, employees, vendors,
    marketingSetting, marketingPages, marketingServices, marketingCoupons,
    marketingTestimonials, marketingGalleryItems,
  ] = await Promise.all([
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: SHOP_SETTINGS_SELECT }),
    prisma.shopMembership.findMany({ where: { shopId }, select: { id: true, userId: true, userEmail: true, role: true }, orderBy: { id: "asc" } }),
    prisma.staffInvite.findMany({ where: { shopId }, select: { id: true, email: true, role: true, status: true }, orderBy: { id: "asc" } }),
    prisma.cannedService.findMany({ where: { shopId }, select: { id: true, name: true, description: true, defaultHours: true, defaultLaborRate: true, active: true, shopSuppliesEligible: true }, orderBy: { id: "asc" } }),
    prisma.employee.findMany({ where: { shopId }, select: { id: true, displayName: true, email: true, role: true, active: true, legacySourceTable: true }, orderBy: { id: "asc" } }),
    prisma.vendor.findMany({ where: { shopId }, select: { id: true, name: true, normalizedName: true }, orderBy: { id: "asc" } }),
    prisma.marketingSetting.findUnique({ where: { shopId } }),
    prisma.marketingPage.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    prisma.marketingService.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    prisma.marketingCoupon.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    prisma.marketingTestimonial.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    prisma.marketingGalleryItem.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
  ]);
  const [signatureDefaults, securitySettings] = await Promise.all([
    prisma.$queryRawUnsafe(
      "SELECT representative_name, signature_sha256, updated_by FROM public.shop_signature_defaults WHERE shop_id = $1::uuid",
      shopId,
    ),
    prisma.$queryRawUnsafe(
      "SELECT mfa_required FROM public.shop_security_settings WHERE shop_id = $1::uuid",
      shopId,
    ),
  ]);
  return normalize({
    version: 3,
    shopId,
    shop,
    memberships,
    invites,
    cannedServices,
    employees,
    vendors,
    marketingSetting,
    marketingPages,
    marketingServices,
    marketingCoupons,
    marketingTestimonials,
    marketingGalleryItems,
    ...configurationEvidence({
      signatureDefaults: signatureDefaults[0] ?? null,
      securitySettings: securitySettings[0] ?? null,
    }),
  });
}

async function main() {
  const mode = process.argv[2];
  if (!new Set(["capture", "verify"]).has(mode)) throw new Error("Usage: final-cutover-preserved-state.mjs capture|verify --file <path> [--shop-id <uuid>]");
  const file = argument("--file");
  if (!file) throw new Error("--file is required.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const shopId = await resolveSingleShopId(prisma, argument("--shop-id"));
    const current = await capture(prisma, shopId);
    if (mode === "capture") {
      const payload = { capturedAt: new Date().toISOString(), ...current };
      await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      console.log(`Preserved configuration snapshot captured: ${file}`);
      return;
    }
    const before = JSON.parse(await readFile(file, "utf8"));
    if (before.shopId !== shopId) throw new Error("Preserved-state snapshot belongs to a different shop.");
    const changed = preservedConfigurationDifferences(before, current);
    const repairOrders = await prisma.repairOrder.findMany({
      where: { shopId },
      select: { repairOrderNumber: true, legacyRoNo: true, legacySourceTable: true },
    });
    const sequence = verifyRepairOrderSequence({
      beforeCounter: before.shop?.nextRepairOrderNumber,
      repairOrders,
      actualCounter: current.shop.nextRepairOrderNumber,
    });
    console.log(`Ordinary configuration preservation: ${changed.length ? "FAIL" : "PASS"}${changed.length ? `; changed sections: ${changed.join(", ")}` : ""}`);
    console.log(`Repair Order sequencing invariant: ${sequence.pass ? "PASS" : "FAIL"}`);
    console.log(`  before=${sequence.beforeValue}`);
    console.log(`  highest operational RO=${sequence.highestOperationalRONumber ?? "none"}`);
    console.log(`  expected=${sequence.expectedValue ?? "undetermined"}`);
    console.log(`  actual=${sequence.actualValue}`);
    if (!sequence.pass) console.log(`  issues=${sequence.issues.join(", ")}`);
    if (changed.length || !sequence.pass) {
      throw new Error("Preserved configuration or Repair Order sequencing verification failed.");
    }
    console.log("Preserved configuration verification: PASS");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
