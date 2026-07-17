import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SHOP_ID = argument("--shop-id");
if (!SHOP_ID) throw new Error("--shop-id is required.");

function textValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const value = rawData[field];
  return typeof value === "string" ? value.trim() || null : null;
}

function numberValue(rawData, field) {
  const value = textValue(rawData, field);
  if (!value) return null;
  const cleaned = value.replaceAll(/[^0-9.-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(rawData, ...fields) {
  const value = fields.map((field) => textValue(rawData, field)).find(Boolean);
  if (!value || !/^\d{8}$/.test(value)) return null;
  const parsed = new Date(Date.UTC(
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)),
  ));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function groupRows(parts, labor) {
  const groups = new Map();
  for (const [kind, rows] of [["parts", parts], ["labor", labor]]) {
    for (const row of rows) {
      const ro = row.legacyRoNo?.trim();
      if (!ro) continue;
      const group = groups.get(ro) ?? { parts: [], labor: [] };
      group[kind].push(row);
      groups.set(ro, group);
    }
  }
  return groups;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const [rawParts, rawLabor, customers, vehicles] = await Promise.all([
      prisma.rawLegacyOrderPart.findMany({
        where: { shopId: SHOP_ID },
        select: { legacyRowKey: true, legacyRoNo: true, legacyCustno: true, legacyCarno: true, rawData: true },
      }),
      prisma.rawLegacyOrderLabor.findMany({
        where: { shopId: SHOP_ID },
        select: { legacyRowKey: true, legacyRoNo: true, legacyCustno: true, legacyCarno: true, rawData: true },
      }),
      prisma.customer.findMany({
        where: { shopId: SHOP_ID, legacyCustno: { not: null } },
        select: { id: true, legacyCustno: true },
      }),
      prisma.vehicle.findMany({
        where: { shopId: SHOP_ID, legacyCarno: { not: null } },
        select: { id: true, legacyCarno: true },
      }),
    ]);

    const customerIds = new Map(customers.map((row) => [row.legacyCustno, row.id]));
    const vehicleIds = new Map(vehicles.map((row) => [row.legacyCarno, row.id]));
    const groups = groupRows(rawParts, rawLabor);
    let validationIssues = rawParts.filter((row) => !row.legacyRoNo).length +
      rawLabor.filter((row) => !row.legacyRoNo).length;
    let linkedCustomers = 0;
    let linkedVehicles = 0;

    for (const [ro, group] of groups) {
      const header = group.parts[0] ?? group.labor[0];
      const legacyCustno = header.legacyCustno ?? group.labor.find((row) => row.legacyCustno)?.legacyCustno;
      const legacyCarno = header.legacyCarno ?? group.labor.find((row) => row.legacyCarno)?.legacyCarno;
      const customerId = legacyCustno ? customerIds.get(legacyCustno) : null;
      const vehicleId = legacyCarno ? vehicleIds.get(legacyCarno) : null;
      if (!customerId || !vehicleId) {
        validationIssues += 1;
        continue;
      }
      linkedCustomers += 1;
      linkedVehicles += 1;

      const partsTotal = group.parts.reduce((sum, row) => {
        const quantity = numberValue(row.rawData, "QTY") ?? 1;
        return sum + (numberValue(row.rawData, "EXT") ?? quantity * (numberValue(row.rawData, "PRICE") ?? 0));
      }, 0);
      const laborTotal = group.labor.reduce((sum, row) => sum +
        (numberValue(row.rawData, "LABOR") ??
          (numberValue(row.rawData, "HOURS") ?? 0) * (numberValue(row.rawData, "LABORRATE") ?? 0)), 0);
      const taxSource = group.parts[0]?.rawData ?? group.labor[0]?.rawData;
      const taxTotal = ["TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6"].reduce(
        (sum, field) => sum + (numberValue(taxSource, field) ?? 0), 0,
      );
      const openedAt = dateValue(header.rawData, "RO_DATE", "DATE_SOLD") ?? new Date(0);
      const odometer = Math.trunc(numberValue(header.rawData, "ODOMETER") ?? 0) || null;
      const repairOrder = await prisma.repairOrder.upsert({
        where: { shopId_legacyRoNo: { shopId: SHOP_ID, legacyRoNo: ro } },
        create: {
          shopId: SHOP_ID, customerId, vehicleId, status: "open", openedAt, odometer,
          partsTotal, laborTotal, taxTotal, estimatedTotal: partsTotal + laborTotal + taxTotal,
          legacyRoNo: ro, legacySourceTable: "orders/LABORorder",
        },
        update: {
          customerId, vehicleId, status: "open", openedAt, odometer,
          partsTotal, laborTotal, taxTotal, estimatedTotal: partsTotal + laborTotal + taxTotal,
          legacySourceTable: "orders/LABORorder",
        },
        select: { id: true },
      });

      for (const row of group.parts) {
        const data = {
          repairOrderId: repairOrder.id,
          description: textValue(row.rawData, "DESC") ?? textValue(row.rawData, "PARTNO") ?? "Legacy part",
          partNumber: textValue(row.rawData, "PARTNO"),
          quantity: numberValue(row.rawData, "QTY") ?? 1,
          unitPrice: numberValue(row.rawData, "PRICE") ?? 0,
          legacyRoNo: ro, legacySourceTable: "orders",
        };
        await prisma.repairOrderPart.upsert({
          where: { shopId_legacyLineKey: { shopId: SHOP_ID, legacyLineKey: row.legacyRowKey } },
          create: { shopId: SHOP_ID, legacyLineKey: row.legacyRowKey, ...data }, update: data,
        });
      }
      for (const row of group.labor) {
        const data = {
          repairOrderId: repairOrder.id,
          description: textValue(row.rawData, "LABOR_DONE") ?? textValue(row.rawData, "JOBDESC") ?? textValue(row.rawData, "CODE") ?? "Legacy labor",
          hours: numberValue(row.rawData, "HOURS") ?? 0,
          hourlyRate: numberValue(row.rawData, "LABORRATE") ?? 0,
          legacyRoNo: ro, legacySourceTable: "LABORorder",
        };
        await prisma.repairOrderLabor.upsert({
          where: { shopId_legacyLineKey: { shopId: SHOP_ID, legacyLineKey: row.legacyRowKey } },
          create: { shopId: SHOP_ID, legacyLineKey: row.legacyRowKey, ...data }, update: data,
        });
      }
    }

    const cleanOpenOrders = await prisma.repairOrder.count({ where: { shopId: SHOP_ID, status: "open" } });
    console.log(`staged part rows: ${rawParts.length}`);
    console.log(`staged labor rows: ${rawLabor.length}`);
    console.log(`clean open orders: ${cleanOpenOrders}`);
    console.log(`linked customers: ${linkedCustomers}`);
    console.log(`linked vehicles: ${linkedVehicles}`);
    console.log(`validation issues: ${validationIssues}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
