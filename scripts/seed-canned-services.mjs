import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const starters = [
  ["Oil Change", "Perform engine oil and filter service", "0.50"],
  ["Tire Rotation", "Rotate tires and inspect tire condition", "0.50"],
  ["Brake Inspection", "Inspect brake system and report condition", "0.50"],
  ["Diagnostic", "Perform initial diagnostic inspection", "1.00"],
];

try {
  const shop = await prisma.shop.findFirst({ where: { name: "CAR DOC LLC" }, select: { id: true, defaultLaborRate: true } });
  if (!shop) throw new Error("Shop is unavailable.");
  let created = 0;
  for (const [name, description, defaultHours] of starters) {
    const existing = await prisma.cannedService.findUnique({ where: { shopId_name: { shopId: shop.id, name } }, select: { id: true } });
    await prisma.cannedService.upsert({
      where: { shopId_name: { shopId: shop.id, name } },
      update: {},
      create: { shopId: shop.id, name, description, defaultHours, defaultLaborRate: shop.defaultLaborRate, active: true },
    });
    if (!existing) created += 1;
  }
  console.log(`services created: ${created}`);
} finally {
  await prisma.$disconnect();
}
