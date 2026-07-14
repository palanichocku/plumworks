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
    where: { shopId, status: "draft", legacySourceTable: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!order) throw new Error("No web-created draft repair order is available.");

  const [importedBefore, partsBefore, existingLine] = await Promise.all([
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrderPart.count({
      where: { shopId, repairOrder: { legacySourceTable: null } },
    }),
    prisma.repairOrderPart.findFirst({
      where: { shopId, legacyLineKey: "web:verification-part-line" },
      select: { id: true },
    }),
  ]);

  if (!existingLine) {
    await prisma.$transaction(async (transaction) => {
      await transaction.repairOrderPart.create({
        data: {
          shopId,
          repairOrderId: order.id,
          description: "Workflow verification part",
          quantity: "2.00",
          unitPrice: "25.00",
          legacyLineKey: "web:verification-part-line",
        },
      });
      const [header, lines] = await Promise.all([
        transaction.repairOrder.findUniqueOrThrow({
          where: { id: order.id },
          select: { laborTotal: true, taxTotal: true },
        }),
        transaction.repairOrderPart.findMany({
          where: { shopId, repairOrderId: order.id },
          select: { quantity: true, unitPrice: true },
        }),
      ]);
      const partsTotal = lines.reduce(
        (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice),
        0,
      );
      await transaction.repairOrder.update({
        where: { id: order.id },
        data: {
          partsTotal: partsTotal.toFixed(2),
          estimatedTotal: (
            partsTotal + Number(header.laborTotal) + Number(header.taxTotal)
          ).toFixed(2),
        },
      });
    });
  }

  const [webRepairOrders, partsAfter, importedAfter, verifiedOrder] = await Promise.all([
    prisma.repairOrder.count({
      where: { shopId, repairOrderNumber: { not: null }, legacySourceTable: null },
    }),
    prisma.repairOrderPart.count({
      where: { shopId, repairOrder: { legacySourceTable: null } },
    }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        partsTotal: true,
        parts: { select: { quantity: true, unitPrice: true } },
      },
    }),
  ]);
  if (importedAfter !== importedBefore) {
    throw new Error("Imported repair-order count changed during verification.");
  }
  const calculated = verifiedOrder.parts.reduce(
    (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice),
    0,
  );
  const validTotal = Math.abs(Number(verifiedOrder.partsTotal) - calculated) < 0.005;
  if (!validTotal) throw new Error("Parts total calculation did not match part lines.");

  console.log(`web-created repair orders: ${webRepairOrders}`);
  console.log(`part lines created: ${partsAfter - partsBefore}`);
  console.log(`web part lines total: ${partsAfter}`);
  console.log(`part total calculations valid: ${validTotal ? 1 : 0}`);
  console.log(`imported repair orders before: ${importedBefore}`);
  console.log(`imported repair orders after: ${importedAfter}`);
} finally {
  await prisma.$disconnect();
}
