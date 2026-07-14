import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

try {
  const membership = await prisma.shopMembership.findFirst({
    orderBy: { createdAt: "asc" },
    select: { shopId: true },
  });
  if (!membership) throw new Error("No shop membership is available for verification.");
  const shopId = membership.shopId;

  const [customersBefore, vehiclesBefore, importedCustomersBefore, importedVehiclesBefore, existingCustomer] = await Promise.all([
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.customer.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.customer.findFirst({
      where: { shopId, legacySourceTable: null, notes: "Web new customer workflow verification" },
      select: { id: true },
    }),
  ]);

  if (!existingCustomer) {
    await prisma.$transaction(async (transaction) => {
      const customer = await transaction.customer.create({
        data: {
          shopId,
          displayName: "Verification Customer",
          notes: "Web new customer workflow verification",
        },
        select: { id: true },
      });
      const vehicle = await transaction.vehicle.create({
        data: {
          shopId,
          customerId: customer.id,
          year: 2020,
          make: "Verification",
          model: "Vehicle",
          notes: "Web new customer workflow verification",
        },
        select: { id: true },
      });
      const shop = await transaction.shop.update({
        where: { id: shopId },
        data: { nextRepairOrderNumber: { increment: 1 } },
        select: { nextRepairOrderNumber: true },
      });
      await transaction.repairOrder.create({
        data: {
          shopId,
          customerId: customer.id,
          vehicleId: vehicle.id,
          repairOrderNumber: shop.nextRepairOrderNumber - 1,
          status: "draft",
          concern: "Web new customer workflow verification",
        },
      });
    }, { isolationLevel: "Serializable" });
  }

  const [customersAfter, vehiclesAfter, importedCustomersAfter, importedVehiclesAfter, webRepairOrders, duplicateRows] = await Promise.all([
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.customer.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, repairOrderNumber: { not: null }, legacySourceTable: null } }),
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT repair_order_number
        FROM repair_orders
        WHERE shop_id = ${shopId}::uuid AND repair_order_number IS NOT NULL
        GROUP BY repair_order_number
        HAVING COUNT(*) > 1
      ) duplicates
    `,
  ]);

  if (importedCustomersAfter !== importedCustomersBefore || importedVehiclesAfter !== importedVehiclesBefore) {
    throw new Error("Imported record counts changed during verification.");
  }
  const duplicateCount = duplicateRows[0]?.count ?? 0;
  if (duplicateCount !== 0) throw new Error("Duplicate repair-order numbers were detected.");

  console.log(`customers before test creation: ${customersBefore}`);
  console.log(`customers after test creation: ${customersAfter}`);
  console.log(`vehicles before test creation: ${vehiclesBefore}`);
  console.log(`vehicles after test creation: ${vehiclesAfter}`);
  console.log(`web-created repair_orders: ${webRepairOrders}`);
  console.log(`imported customers before: ${importedCustomersBefore}`);
  console.log(`imported customers after: ${importedCustomersAfter}`);
  console.log(`imported vehicles before: ${importedVehiclesBefore}`);
  console.log(`imported vehicles after: ${importedVehiclesAfter}`);
  console.log(`duplicate repair_order_number count: ${duplicateCount}`);
} finally {
  await prisma.$disconnect();
}
