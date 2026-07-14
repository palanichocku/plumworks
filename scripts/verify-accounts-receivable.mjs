import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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
  const importedBefore = await prisma.accountReceivable.count({
    where: { shopId, legacySourceTable: { not: null } },
  });
  const [total, open, paid, importedAfter, web] = await Promise.all([
    prisma.accountReceivable.count({ where: { shopId } }),
    prisma.accountReceivable.count({ where: { shopId, status: "open" } }),
    prisma.accountReceivable.count({ where: { shopId, status: "paid" } }),
    prisma.accountReceivable.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.accountReceivable.count({
      where: {
        shopId,
        legacySourceTable: null,
        invoice: { legacySourceTable: null, repairOrderNumber: { not: null } },
      },
    }),
  ]);
  if (importedAfter !== importedBefore) throw new Error("Imported AR count changed.");

  console.log(`total AR rows: ${total}`);
  console.log(`open AR rows: ${open}`);
  console.log(`paid AR rows: ${paid}`);
  console.log(`imported AR rows before: ${importedBefore}`);
  console.log(`imported AR rows after: ${importedAfter}`);
  console.log(`web AR rows: ${web}`);
} finally {
  await prisma.$disconnect();
}
