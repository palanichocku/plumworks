import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const rollback = new Error("ROLLBACK_VERIFICATION");
const allowedKeys = new Set(["source", "invoiceId", "method", "active"]);
const allowedWords = new Set(["web", "manual", "canned_service", "cash", "card", "check", "other"]);
const uuid = /^[0-9a-f-]{36}$/i;

function safeMetadata(value) {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (!allowedKeys.has(key)) return false;
    return typeof item === "boolean" || (typeof item === "string" && (allowedWords.has(item) || uuid.test(item)));
  });
}

try {
  const shop = await prisma.shop.findFirst({ select: { id: true } });
  if (!shop) throw new Error("Shop is unavailable.");
  const [importedCustomersBefore, importedVehiclesBefore, importedInvoicesBefore, importedOrdersBefore] = await Promise.all([
    prisma.customer.count({ where: { legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { legacySourceTable: { not: null } } }),
  ]);
  let sampleRows = 0;
  try {
    await prisma.$transaction(async (transaction) => {
      for (const action of ["customer_updated", "repair_order_created", "payment_recorded"]) {
        await transaction.auditLog.create({ data: { shopId: shop.id, action, entityType: "verification", entityId: randomUUID(), metadata: { source: "web" } } });
      }
      sampleRows = await transaction.auditLog.count({ where: { shopId: shop.id, entityType: "verification" } });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [logs, importedCustomersAfter, importedVehiclesAfter, importedInvoicesAfter, importedOrdersAfter] = await Promise.all([
    prisma.auditLog.findMany({ select: { metadata: true } }),
    prisma.customer.count({ where: { legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { legacySourceTable: { not: null } } }),
  ]);
  const importedUnchanged = importedCustomersBefore === importedCustomersAfter && importedVehiclesBefore === importedVehiclesAfter && importedInvoicesBefore === importedInvoicesAfter && importedOrdersBefore === importedOrdersAfter;
  console.log(`audit rows created for sample actions: ${sampleRows}`);
  console.log(`imported records unchanged: ${Number(importedUnchanged)}`);
  console.log(`metadata safety check passed: ${Number(logs.every((log) => safeMetadata(log.metadata)))}`);
} finally {
  await prisma.$disconnect();
}
