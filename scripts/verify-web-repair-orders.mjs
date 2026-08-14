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
  const importedBefore = await prisma.repairOrder.count({
    where: { shopId, legacySourceTable: { not: null } },
  });
  const vehicle = await prisma.vehicle.findFirst({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    select: { id: true, customerId: true },
  });
  if (!vehicle) throw new Error("No customer-owned vehicle is available for verification.");

  const existingDraft = await prisma.repairOrder.findFirst({
    where: {
      shopId,
      legacySourceTable: null,
      concern: "Web repair order workflow verification",
    },
    select: { id: true, repairOrderNumber: true, legacyRoNo: true },
  });

  const draft = existingDraft ?? await prisma.$transaction(async (transaction) => {
    const shop = await transaction.shop.update({
      where: { id: shopId },
      data: { nextRepairOrderNumber: { increment: 1 } },
      select: { nextRepairOrderNumber: true },
    });
    return transaction.repairOrder.create({
      data: {
        shopId,
        customerId: vehicle.customerId,
        vehicleId: vehicle.id,
        repairOrderNumber: shop.nextRepairOrderNumber - 1,
        status: "draft",
        concern: "Web repair order workflow verification",
      },
      select: { id: true, repairOrderNumber: true, legacyRoNo: true },
    });
  }, { isolationLevel: "Serializable" });

  if (draft.repairOrderNumber === null) throw new Error("Draft RO number was not assigned.");
  if (draft.legacyRoNo !== null) throw new Error("Draft unexpectedly changed a legacy RO number.");

  const [shop, total, webCreated, imported, duplicateRows, legacyMaximumRows] = await Promise.all([
    prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { nextRepairOrderNumber: true },
    }),
    prisma.repairOrder.count({ where: { shopId } }),
    prisma.repairOrder.count({
      where: { shopId, repairOrderNumber: { not: null }, legacySourceTable: null, legacyRoNo: null },
    }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
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
    prisma.$queryRaw`
      SELECT COALESCE(MAX(legacy_ro_no::integer), 0)::int AS maximum
      FROM repair_orders
      WHERE shop_id = ${shopId}::uuid AND legacy_ro_no ~ '^[0-9]+$'
    `,
  ]);

  const duplicateCount = duplicateRows[0]?.count ?? 0;
  const legacyMaximum = legacyMaximumRows[0]?.maximum ?? 0;
  if (duplicateCount !== 0) throw new Error("Duplicate web repair-order numbers were detected.");
  if (shop.nextRepairOrderNumber <= legacyMaximum) throw new Error("Shop RO counter was not initialized above legacy RO numbers.");
  if (imported !== importedBefore) throw new Error("Imported repair-order count changed during verification.");

  console.log(`total repair_orders: ${total}`);
  console.log(`web-created repair_orders: ${webCreated}`);
  console.log(`imported/legacy repair_orders: ${imported}`);
  console.log(`duplicate repair_order_number count: ${duplicateCount}`);
  console.log(`current shops.next_repair_order_number: ${shop.nextRepairOrderNumber}`);
} finally {
  await prisma.$disconnect();
}
