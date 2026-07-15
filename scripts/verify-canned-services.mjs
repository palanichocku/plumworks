import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const rollback = new Error("ROLLBACK_VERIFICATION");

try {
  const shop = await prisma.shop.findFirst({ where: { name: "CAR DOC LLC" }, select: { id: true } });
  if (!shop) throw new Error("Shop is unavailable.");
  const [serviceCount, importedCustomersBefore, importedVehiclesBefore, importedInvoicesBefore, importedOrdersBefore] = await Promise.all([
    prisma.cannedService.count({ where: { shopId: shop.id } }),
    prisma.customer.count({ where: { legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { legacySourceTable: { not: null } } }),
  ]);
  let serviceAdded = 0;
  try {
    await prisma.$transaction(async (transaction) => {
      const service = await transaction.cannedService.findFirst({ where: { shopId: shop.id, active: true } });
      const vehicle = await transaction.vehicle.findFirst({ where: { shopId: shop.id }, select: { id: true, customerId: true } });
      if (!service || !vehicle) throw new Error("Verification prerequisites are unavailable.");
      const order = await transaction.repairOrder.create({ data: { shopId: shop.id, customerId: vehicle.customerId, vehicleId: vehicle.id, repairOrderNumber: -randomInt(1, 2_000_000_000), status: "draft" } });
      const line = await transaction.repairOrderLabor.create({ data: { shopId: shop.id, repairOrderId: order.id, description: service.description, hours: service.defaultHours, hourlyRate: service.defaultLaborRate, legacyLineKey: `verify:${randomUUID()}` } });
      serviceAdded = Number(Boolean(line.id));
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [importedCustomersAfter, importedVehiclesAfter, importedInvoicesAfter, importedOrdersAfter] = await Promise.all([
    prisma.customer.count({ where: { legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { legacySourceTable: { not: null } } }),
  ]);
  const importedUnchanged = importedCustomersBefore === importedCustomersAfter && importedVehiclesBefore === importedVehiclesAfter && importedInvoicesBefore === importedInvoicesAfter && importedOrdersBefore === importedOrdersAfter;
  console.log(`services available: ${serviceCount}`);
  console.log(`service added to draft repair order: ${serviceAdded}`);
  console.log(`imported records unchanged: ${Number(importedUnchanged)}`);
} finally {
  await prisma.$disconnect();
}
