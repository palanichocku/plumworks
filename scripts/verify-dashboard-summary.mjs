import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function importedCounts(shopId) {
  return Promise.all([
    prisma.customer.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.accountReceivable.count({ where: { shopId, legacySourceTable: { not: null } } }),
  ]);
}

try {
  const membership = await prisma.shopMembership.findFirst({
    orderBy: { createdAt: "asc" },
    select: { shopId: true },
  });
  if (!membership) throw new Error("No shop membership is available for verification.");
  const shopId = membership.shopId;
  const recentSince = new Date();
  recentSince.setUTCDate(recentSince.getUTCDate() - 30);
  const importedBefore = await importedCounts(shopId);

  const summary = await Promise.all([
    prisma.repairOrder.count({ where: { shopId, status: { in: ["draft", "open"] } } }),
    prisma.repairOrder.count({ where: { shopId, status: { in: ["draft", "open"] }, legacySourceTable: null, repairOrderNumber: { not: null } } }),
    prisma.accountReceivable.count({ where: { shopId, status: "open", balance: { gt: 0 } } }),
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.invoice.count({ where: { shopId, invoiceDate: { gte: recentSince } } }),
  ]);
  const sourceCounts = await Promise.all([
    prisma.repairOrder.count({ where: { shopId, status: { in: ["draft", "open"] } } }),
    prisma.repairOrder.count({ where: { shopId, status: { in: ["draft", "open"] }, legacySourceTable: null, repairOrderNumber: { not: null } } }),
    prisma.accountReceivable.count({ where: { shopId, status: "open", balance: { gt: 0 } } }),
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.invoice.count({ where: { shopId, invoiceDate: { gte: recentSince } } }),
  ]);
  const matched = summary.filter((value, index) => value === sourceCounts[index]).length;
  const importedAfter = await importedCounts(shopId);
  const importedUnchanged = importedBefore.every((value, index) => value === importedAfter[index]);
  if (matched !== summary.length || !importedUnchanged) throw new Error("Dashboard verification failed.");

  console.log(`open repair orders: ${summary[0]}`);
  console.log(`web draft/open repair orders: ${summary[1]}`);
  console.log(`open AR rows: ${summary[2]}`);
  console.log(`total customers: ${summary[3]}`);
  console.log(`total vehicles: ${summary[4]}`);
  console.log(`recent invoices: ${summary[5]}`);
  console.log(`dashboard source counts matched: ${matched}`);
  console.log(`imported legacy count groups unchanged: ${importedUnchanged ? importedBefore.length : 0}`);
} finally {
  await prisma.$disconnect();
}
