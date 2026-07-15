import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

function correctlyOrdered(rows) {
  return rows.every((row, index) => {
    if (index === 0) return true;
    const previous = rows[index - 1];
    const updatedDifference = previous.updatedAt.getTime() - row.updatedAt.getTime();
    if (updatedDifference !== 0) return updatedDifference > 0;
    const createdDifference = previous.createdAt.getTime() - row.createdAt.getTime();
    if (createdDifference !== 0) return createdDifference > 0;
    return previous.id.localeCompare(row.id) >= 0;
  });
}

try {
  const membership = await prisma.shopMembership.findFirst({ orderBy: { createdAt: "asc" }, select: { shopId: true } });
  if (!membership) throw new Error("No shop membership is available for verification.");
  const shopId = membership.shopId;
  const [invoiceRows, customerRows, repairOrderRows, arRows] = await Promise.all([
    prisma.invoice.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, updatedAt: true, createdAt: true } }),
    prisma.customer.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, updatedAt: true, createdAt: true } }),
    prisma.repairOrder.findMany({ where: { shopId, status: { in: ["draft", "open"] } }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, updatedAt: true, createdAt: true } }),
    prisma.accountReceivable.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, updatedAt: true, createdAt: true } }),
  ]);
  const orderChecks = [invoiceRows, customerRows, repairOrderRows, arRows].map(correctlyOrdered);
  if (orderChecks.some((check) => !check)) throw new Error("A listing order check failed.");

  const vehicle = await prisma.vehicle.findFirst({ where: { shopId }, orderBy: { createdAt: "asc" }, select: { id: true, customerId: true } });
  if (!vehicle) throw new Error("No customer-owned vehicle is available for deletion verification.");
  const [customersBefore, vehiclesBefore, importedOrdersBefore, finalizedInvoicesBefore] = await Promise.all([
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { shopId, status: { in: ["finalized", "paid"] } } }),
  ]);

  const testOrder = await prisma.$transaction(async (transaction) => {
    const shop = await transaction.shop.update({ where: { id: shopId }, data: { nextRepairOrderNumber: { increment: 1 } }, select: { nextRepairOrderNumber: true } });
    return transaction.repairOrder.create({
      data: {
        shopId, customerId: vehicle.customerId, vehicleId: vehicle.id,
        repairOrderNumber: shop.nextRepairOrderNumber - 1, status: "draft",
        concern: "Draft deletion verification",
        parts: { create: { shopId, description: "Verification part", quantity: 1, unitPrice: 0, legacyLineKey: `web:${randomUUID()}` } },
        labor: { create: { shopId, description: "Verification labor", hours: 1, hourlyRate: 0, legacyLineKey: `web:${randomUUID()}` } },
      },
      select: { id: true },
    });
  });

  const deleted = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM repair_orders WHERE id = ${testOrder.id}::uuid AND shop_id = ${shopId}::uuid FOR UPDATE`;
    const eligible = await transaction.repairOrder.findFirst({ where: { id: testOrder.id, shopId, legacySourceTable: null, repairOrderNumber: { not: null }, status: { in: ["draft", "open"] }, invoices: { none: {} } }, select: { id: true } });
    if (!eligible) return 0;
    await transaction.repairOrder.delete({ where: { id: eligible.id } });
    return 1;
  });

  const [customersAfter, vehiclesAfter, importedOrdersAfter, finalizedInvoicesAfter, testOrdersRemaining, testPartLines, testLaborLines] = await Promise.all([
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { shopId, status: { in: ["finalized", "paid"] } } }),
    prisma.repairOrder.count({ where: { id: testOrder.id } }),
    prisma.repairOrderPart.count({ where: { repairOrderId: testOrder.id } }),
    prisma.repairOrderLabor.count({ where: { repairOrderId: testOrder.id } }),
  ]);
  const customerUnchanged = customersBefore === customersAfter;
  const vehicleUnchanged = vehiclesBefore === vehiclesAfter;
  const importedUnchanged = importedOrdersBefore === importedOrdersAfter;
  const finalizedUnchanged = finalizedInvoicesBefore === finalizedInvoicesAfter;
  if (deleted !== 1 || testOrdersRemaining || testPartLines || testLaborLines || !customerUnchanged || !vehicleUnchanged || !importedUnchanged || !finalizedUnchanged) throw new Error("Draft deletion verification failed.");

  console.log(`invoices listing order valid: ${orderChecks[0] ? 1 : 0}`);
  console.log(`customers listing order valid: ${orderChecks[1] ? 1 : 0}`);
  console.log(`repair orders listing order valid: ${orderChecks[2] ? 1 : 0}`);
  console.log(`AR listing order valid: ${orderChecks[3] ? 1 : 0}`);
  console.log(`draft repair order deletions succeeded: ${deleted}`);
  console.log(`customer count unchanged: ${customerUnchanged ? 1 : 0}`);
  console.log(`vehicle count unchanged: ${vehicleUnchanged ? 1 : 0}`);
  console.log(`imported open orders unchanged: ${importedUnchanged ? 1 : 0}`);
  console.log(`finalized invoices unchanged: ${finalizedUnchanged ? 1 : 0}`);
  console.log(`draft child lines remaining: ${testPartLines + testLaborLines}`);
} finally {
  await prisma.$disconnect();
}
