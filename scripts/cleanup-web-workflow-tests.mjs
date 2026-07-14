import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const dryRun = process.argv.includes("--dry-run");
const concerns = [
  "Web repair order workflow verification",
  "Web new vehicle workflow verification",
  "Web new customer workflow verification",
];
const customerNotes = ["Web new customer workflow verification"];
const vehicleNotes = [
  "Web new vehicle workflow verification",
  "Web new customer workflow verification",
];

try {
  const membership = await prisma.shopMembership.findFirst({
    orderBy: { createdAt: "asc" },
    select: { shopId: true },
  });
  if (!membership) throw new Error("No shop membership is available for cleanup.");
  const shopId = membership.shopId;

  const [orders, customers, vehicles, importedCustomersBefore, importedVehiclesBefore, importedInvoicesBefore, importedOrdersBefore] = await Promise.all([
    prisma.repairOrder.findMany({
      where: { shopId, legacySourceTable: null, concern: { in: concerns } },
      select: { id: true },
    }),
    prisma.customer.findMany({
      where: { shopId, legacySourceTable: null, notes: { in: customerNotes } },
      select: { id: true },
    }),
    prisma.vehicle.findMany({
      where: { shopId, legacySourceTable: null, notes: { in: vehicleNotes } },
      select: { id: true },
    }),
    prisma.customer.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
  ]);
  const orderIds = orders.map((row) => row.id);
  const customerIds = customers.map((row) => row.id);
  const vehicleIds = vehicles.map((row) => row.id);
  const invoices = await prisma.invoice.findMany({
    where: { shopId, legacySourceTable: null, repairOrderId: { in: orderIds } },
    select: { id: true },
  });
  const invoiceIds = invoices.map((row) => row.id);

  const [payments, arRows, partLines, laborLines, externalCustomerOrders, externalVehicleOrders, externalCustomerVehicles, externalCustomerInvoices, externalVehicleInvoices, externalCustomerPayments, externalCustomerAr] = await Promise.all([
    prisma.payment.count({ where: { shopId, invoiceId: { in: invoiceIds }, legacySourceTable: null } }),
    prisma.accountReceivable.count({ where: { shopId, invoiceId: { in: invoiceIds }, legacySourceTable: null } }),
    prisma.repairOrderPart.count({ where: { shopId, repairOrderId: { in: orderIds }, legacySourceTable: null } }),
    prisma.repairOrderLabor.count({ where: { shopId, repairOrderId: { in: orderIds }, legacySourceTable: null } }),
    prisma.repairOrder.count({ where: { shopId, customerId: { in: customerIds }, id: { notIn: orderIds } } }),
    prisma.repairOrder.count({ where: { shopId, vehicleId: { in: vehicleIds }, id: { notIn: orderIds } } }),
    prisma.vehicle.count({ where: { shopId, customerId: { in: customerIds }, id: { notIn: vehicleIds } } }),
    prisma.invoice.count({ where: { shopId, customerId: { in: customerIds }, id: { notIn: invoiceIds } } }),
    prisma.invoice.count({ where: { shopId, vehicleId: { in: vehicleIds }, id: { notIn: invoiceIds } } }),
    prisma.payment.count({ where: { shopId, customerId: { in: customerIds }, invoiceId: { notIn: invoiceIds } } }),
    prisma.accountReceivable.count({ where: { shopId, customerId: { in: customerIds }, invoiceId: { notIn: invoiceIds } } }),
  ]);
  const ambiguousReferences = externalCustomerOrders + externalVehicleOrders +
    externalCustomerVehicles + externalCustomerInvoices + externalVehicleInvoices +
    externalCustomerPayments + externalCustomerAr;

  console.log(`candidate test customers: ${customers.length}`);
  console.log(`candidate test vehicles: ${vehicles.length}`);
  console.log(`candidate test repair orders: ${orders.length}`);
  console.log(`candidate test invoices: ${invoices.length}`);
  console.log(`candidate test payments: ${payments}`);
  console.log(`candidate test AR rows: ${arRows}`);
  console.log(`candidate test part lines: ${partLines}`);
  console.log(`candidate test labor lines: ${laborLines}`);
  console.log(`ambiguous non-test references: ${ambiguousReferences}`);

  if (dryRun || ambiguousReferences > 0) {
    console.log(`cleanup performed: 0`);
    if (ambiguousReferences > 0) process.exitCode = 2;
  } else {
    await prisma.$transaction(async (transaction) => {
      await transaction.payment.deleteMany({ where: { shopId, invoiceId: { in: invoiceIds }, legacySourceTable: null } });
      await transaction.accountReceivable.deleteMany({ where: { shopId, invoiceId: { in: invoiceIds }, legacySourceTable: null } });
      await transaction.invoice.deleteMany({ where: { shopId, id: { in: invoiceIds }, legacySourceTable: null } });
      await transaction.repairOrder.deleteMany({ where: { shopId, id: { in: orderIds }, legacySourceTable: null } });
      await transaction.vehicle.deleteMany({ where: { shopId, id: { in: vehicleIds }, legacySourceTable: null } });
      await transaction.customer.deleteMany({ where: { shopId, id: { in: customerIds }, legacySourceTable: null } });
    });
    console.log(`cleanup performed: 1`);
  }

  const [testCustomersAfter, testVehiclesAfter, testOrdersAfter, testInvoicesAfter, importedCustomersAfter, importedVehiclesAfter, importedInvoicesAfter, importedOrdersAfter] = await Promise.all([
    prisma.customer.count({ where: { shopId, legacySourceTable: null, notes: { in: customerNotes } } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: null, notes: { in: vehicleNotes } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: null, concern: { in: concerns } } }),
    prisma.invoice.count({ where: { shopId, legacySourceTable: null, repairOrderId: { in: orderIds } } }),
    prisma.customer.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
  ]);
  const importedUnchanged = importedCustomersBefore === importedCustomersAfter && importedVehiclesBefore === importedVehiclesAfter && importedInvoicesBefore === importedInvoicesAfter && importedOrdersBefore === importedOrdersAfter;
  console.log(`test customers remaining: ${testCustomersAfter}`);
  console.log(`test vehicles remaining: ${testVehiclesAfter}`);
  console.log(`test repair orders remaining: ${testOrdersAfter}`);
  console.log(`test invoices remaining: ${testInvoicesAfter}`);
  console.log(`imported records unchanged: ${importedUnchanged ? 1 : 0}`);
} finally {
  await prisma.$disconnect();
}
