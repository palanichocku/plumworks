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
  const order = await prisma.repairOrder.findFirst({
    where: { shopId, status: "draft", legacySourceTable: null, legacyRoNo: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!order) throw new Error("No web-created draft repair order is available.");

  const [importedBefore, laborBefore, existingLine] = await Promise.all([
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrderLabor.count({
      where: { shopId, repairOrder: { legacySourceTable: null, legacyRoNo: null } },
    }),
    prisma.repairOrderLabor.findFirst({
      where: { shopId, legacyLineKey: "web:verification-labor-line" },
      select: { id: true },
    }),
  ]);

  if (!existingLine) {
    await prisma.$transaction(async (transaction) => {
      await transaction.repairOrderLabor.create({
        data: {
          shopId,
          repairOrderId: order.id,
          description: "Workflow verification labor",
          hours: "1.50",
          hourlyRate: "100.00",
          legacyLineKey: "web:verification-labor-line",
        },
      });
      const [header, lines] = await Promise.all([
        transaction.repairOrder.findUniqueOrThrow({
          where: { id: order.id },
          select: { partsTotal: true, taxTotal: true },
        }),
        transaction.repairOrderLabor.findMany({
          where: { shopId, repairOrderId: order.id },
          select: { hours: true, hourlyRate: true },
        }),
      ]);
      const laborTotal = lines.reduce(
        (sum, line) => sum + Number(line.hours) * Number(line.hourlyRate),
        0,
      );
      await transaction.repairOrder.update({
        where: { id: order.id },
        data: {
          laborTotal: laborTotal.toFixed(2),
          estimatedTotal: (
            Number(header.partsTotal) + laborTotal + Number(header.taxTotal)
          ).toFixed(2),
        },
      });
    });
  }

  const [webRepairOrders, laborAfter, importedAfter, verifiedOrder] = await Promise.all([
    prisma.repairOrder.count({
      where: { shopId, repairOrderNumber: { not: null }, legacySourceTable: null, legacyRoNo: null },
    }),
    prisma.repairOrderLabor.count({
      where: { shopId, repairOrder: { legacySourceTable: null, legacyRoNo: null } },
    }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        laborTotal: true,
        labor: { select: { hours: true, hourlyRate: true } },
      },
    }),
  ]);
  if (importedAfter !== importedBefore) {
    throw new Error("Imported repair-order count changed during verification.");
  }
  const calculated = verifiedOrder.labor.reduce(
    (sum, line) => sum + Number(line.hours) * Number(line.hourlyRate),
    0,
  );
  const validTotal = Math.abs(Number(verifiedOrder.laborTotal) - calculated) < 0.005;
  if (!validTotal) throw new Error("Labor total calculation did not match labor lines.");

  console.log(`web-created repair orders: ${webRepairOrders}`);
  console.log(`labor lines created: ${laborAfter - laborBefore}`);
  console.log(`web labor lines total: ${laborAfter}`);
  console.log(`labor total calculations valid: ${validTotal ? 1 : 0}`);
  console.log(`imported repair orders before: ${importedBefore}`);
  console.log(`imported repair orders after: ${importedAfter}`);
} finally {
  await prisma.$disconnect();
}
