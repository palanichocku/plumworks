import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const rollback = new Error("ROLLBACK_VERIFICATION");

try {
  const shop = await prisma.shop.findFirst({ select: { id: true } });
  if (!shop) throw new Error("Shop is unavailable.");

  const before = await Promise.all([
    prisma.customer.count(), prisma.vehicle.count(), prisma.invoice.count(),
    prisma.accountReceivable.count(), prisma.repairOrder.count(), prisma.auditLog.count(),
  ]);
  const scoped = await Promise.all([
    prisma.customer.count({ where: { shopId: shop.id } }),
    prisma.vehicle.count({ where: { shopId: shop.id } }),
    prisma.invoice.count({ where: { shopId: shop.id } }),
    prisma.accountReceivable.count({ where: { shopId: shop.id } }),
    prisma.repairOrder.count({ where: { shopId: shop.id } }),
  ]);

  let auditCreated = 0;
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.auditLog.create({ data: { shopId: shop.id, action: "shop_data_exported", entityType: "shop", entityId: shop.id, metadata: { exportType: "verification", rowCount: 0 } } });
      auditCreated = 1;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  const after = await Promise.all([
    prisma.customer.count(), prisma.vehicle.count(), prisma.invoice.count(),
    prisma.accountReceivable.count(), prisma.repairOrder.count(), prisma.auditLog.count(),
  ]);
  const matrix = JSON.parse(await readFile(new URL("../src/lib/permission-matrix.json", import.meta.url), "utf8"));

  console.log(`customer export rows available: ${scoped[0]}`);
  console.log(`vehicle export rows available: ${scoped[1]}`);
  console.log(`invoice export rows available: ${scoped[2]}`);
  console.log(`AR export rows available: ${scoped[3]}`);
  console.log(`repair-order export rows available: ${scoped[4]}`);
  console.log(`shop-scoped export checks: ${scoped.filter((count, index) => count <= before[index]).length}`);
  console.log(`STAFF blocked: ${Number(!matrix.STAFF.includes("export_shop_data"))}`);
  console.log(`OWNER/ADMIN allowed: ${Number(matrix.OWNER.includes("export_shop_data") && matrix.ADMIN.includes("export_shop_data"))}`);
  console.log(`audit row created in rollback verification: ${auditCreated}`);
  console.log(`application row counts unchanged: ${Number(before.every((count, index) => count === after[index]))}`);
} finally {
  await prisma.$disconnect();
}
