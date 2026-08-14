import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const membership = await prisma.shopMembership.findFirst({
    orderBy: { createdAt: "asc" },
    select: { shopId: true },
  });
  if (!membership) throw new Error("No shop membership is available for verification.");
  const shopId = membership.shopId;
  const [importedInvoicesBefore, importedOpenBefore] = await Promise.all([
    prisma.invoice.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
  ]);
  const candidate = await prisma.repairOrder.findFirst({
    where: {
      shopId,
      legacySourceTable: null,
      legacyRoNo: null,
      repairOrderNumber: { not: null },
      status: { in: ["draft", "open"] },
      invoices: { none: {} },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (candidate) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM repair_orders WHERE id = ${candidate.id}::uuid AND shop_id = ${shopId}::uuid FOR UPDATE`;
      const order = await transaction.repairOrder.findFirstOrThrow({
        where: { id: candidate.id, shopId, legacySourceTable: null, legacyRoNo: null, repairOrderNumber: { not: null }, status: { in: ["draft", "open"] }, invoices: { none: {} } },
        select: {
          id: true, shopId: true, customerId: true, vehicleId: true,
          repairOrderNumber: true, taxTotal: true,
          shop: { select: { name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true } },
          customer: { select: { displayName: true, phone: true, email: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true } },
          vehicle: { select: { year: true, make: true, model: true, engine: true, vin: true, licensePlate: true, odometer: true } },
          parts: { select: { description: true, partNumber: true, quantity: true, unitPrice: true, legacyLineKey: true } },
          labor: { select: { description: true, hours: true, hourlyRate: true, legacyLineKey: true } },
        },
      });
      const zero = new Prisma.Decimal(0);
      const partsTotal = order.parts.reduce((sum, line) => sum.plus(line.quantity.mul(line.unitPrice).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
      const laborTotal = order.labor.reduce((sum, line) => sum.plus(line.hours.mul(line.hourlyRate).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
      const subtotal = partsTotal.plus(laborTotal).toDecimalPlaces(2);
      const taxTotal = order.taxTotal.toDecimalPlaces(2);
      const total = subtotal.plus(taxTotal).toDecimalPlaces(2);
      const now = new Date();
      await transaction.invoice.create({
        data: {
          shopId: order.shopId, repairOrderId: order.id,
          repairOrderNumber: order.repairOrderNumber,
          customerId: order.customerId, vehicleId: order.vehicleId,
          status: "finalized", invoiceDate: now, partsTotal, laborTotal,
          subtotal, taxTotal, total, paidTotal: zero,
          shopSnapshot: order.shop, customerSnapshot: order.customer,
          vehicleSnapshot: order.vehicle,
          parts: { create: order.parts.map((line) => ({ shopId: order.shopId, ...line })) },
          labor: { create: order.labor.map((line) => ({ shopId: order.shopId, ...line })) },
          accountsReceivable: { create: { shopId: order.shopId, customerId: order.customerId, balance: total, status: total.greaterThan(0) ? "open" : "paid" } },
        },
      });
      await transaction.repairOrder.update({
        where: { id: order.id },
        data: { status: "finalized", closedAt: now, partsTotal, laborTotal, estimatedTotal: total },
      });
    }, { isolationLevel: "Serializable" });
  }

  const [webOrders, finalizedOrders, linkedInvoices, arRows, importedInvoicesAfter, importedOpenAfter, duplicateRepairOrders, duplicateNumbers] = await Promise.all([
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: null, legacyRoNo: null, repairOrderNumber: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: null, legacyRoNo: null, status: "finalized" } }),
    prisma.invoice.count({ where: { shopId, repairOrderId: { not: null }, legacySourceTable: null } }),
    prisma.accountReceivable.count({ where: { shopId, invoice: { repairOrderId: { not: null }, legacySourceTable: null } } }),
    prisma.invoice.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM (SELECT repair_order_id FROM invoices WHERE shop_id = ${shopId}::uuid AND repair_order_id IS NOT NULL GROUP BY repair_order_id HAVING COUNT(*) > 1) duplicates`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM (SELECT repair_order_number FROM invoices WHERE shop_id = ${shopId}::uuid AND repair_order_number IS NOT NULL GROUP BY repair_order_number HAVING COUNT(*) > 1) duplicates`,
  ]);
  if (importedInvoicesBefore !== importedInvoicesAfter || importedOpenBefore !== importedOpenAfter) throw new Error("Imported record counts changed.");

  console.log(`web-created repair orders: ${webOrders}`);
  console.log(`finalized repair orders: ${finalizedOrders}`);
  console.log(`invoices created from repair orders: ${linkedInvoices}`);
  console.log(`duplicate repair_order_id invoice count: ${duplicateRepairOrders[0]?.count ?? 0}`);
  console.log(`duplicate shop repair_order_number invoice count: ${duplicateNumbers[0]?.count ?? 0}`);
  console.log(`AR rows for finalized invoices: ${arRows}`);
  console.log(`imported legacy invoices before: ${importedInvoicesBefore}`);
  console.log(`imported legacy invoices after: ${importedInvoicesAfter}`);
  console.log(`imported open orders before: ${importedOpenBefore}`);
  console.log(`imported open orders after: ${importedOpenAfter}`);
} finally {
  await prisma.$disconnect();
}
