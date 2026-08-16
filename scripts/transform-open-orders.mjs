import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { normalizeLegacyOdometer } from "./lib/legacy-odometer.mjs";
import {
  finalCutoverAdjudicationArguments,
  loadFinalCutoverAdjudicationContext,
} from "./lib/legacy-final-cutover-adjudication.mjs";
import {
  finalCutoverResolutionArguments,
  loadFinalCutoverResolutionContext,
} from "./lib/legacy-final-cutover-resolution.mjs";
import { resolveLegacySource } from "./lib/legacy-source.mjs";
import {
  FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION,
  FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION_FLAG,
  FINAL_CUTOVER_OPEN_ORDER_FLAG,
  projectFinalCutoverOpenOrders,
} from "./lib/legacy-open-order-projection.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SHOP_ID = argument("--shop-id");
if (!SHOP_ID) throw new Error("--shop-id is required.");
const finalCutoverOperational = process.argv.includes(FINAL_CUTOVER_OPEN_ORDER_FLAG);
const adjudicationArguments = finalCutoverAdjudicationArguments(process.argv.slice(2));
const resolutionArguments = finalCutoverResolutionArguments(process.argv.slice(2));
if (adjudicationArguments.manifestPath && !finalCutoverOperational) {
  throw new Error("Active-RO adjudication is valid only in explicit final-cutover operational mode.");
}
if (resolutionArguments.manifestPath && !finalCutoverOperational) {
  throw new Error("Active-RO resolution is valid only in explicit final-cutover operational mode.");
}
if (finalCutoverOperational && argument(FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION_FLAG) !== FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION) {
  throw new Error("Final-cutover operationalization requires its explicit confirmation token.");
}

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
        select: { id: true, customerId: true, legacyCarno: true },
      }),
    ]);

    if (finalCutoverOperational) {
      const adjudicationSource = adjudicationArguments.manifestPath ? await resolveLegacySource({
        args: process.argv.slice(2),
        requiredFiles: ["Cust.DBF", "vehicles.DBF", "FINAL.DBF", "laborfinal.DBF", "laborfinal.FPT", "ar.DBF", "orders.DBF", "LABORorder.DBF"],
      }) : null;
      const adjudicationContext = adjudicationSource ? await loadFinalCutoverAdjudicationContext({
        manifestPath: adjudicationArguments.manifestPath,
        snapshotManifestPath: adjudicationArguments.snapshotManifestPath,
        shopId: SHOP_ID,
        source: adjudicationSource,
      }) : null;
      const resolutionSource = resolutionArguments.manifestPath ? (adjudicationSource ?? await resolveLegacySource({
        args: process.argv.slice(2),
        requiredFiles: ["Cust.DBF", "vehicles.DBF", "FINAL.DBF", "laborfinal.DBF", "laborfinal.FPT", "ar.DBF", "orders.DBF", "LABORorder.DBF"],
      })) : null;
      const resolutionContext = resolutionSource ? await loadFinalCutoverResolutionContext({
        manifestPath: resolutionArguments.manifestPath,
        snapshotManifestPath: resolutionArguments.snapshotManifestPath,
        shopId: SHOP_ID,
        source: resolutionSource,
      }) : null;
      if (adjudicationContext) {
        const stagedKeys = new Set([...rawParts, ...rawLabor].map((row) => row.legacyRowKey));
        const missing = [...adjudicationContext.plan.excludedRowKeys].filter((key) => !stagedKeys.has(key));
        if (missing.length) throw new Error("Final-cutover adjudication source rows do not match staged open-order rows.");
      }
      if (resolutionContext) {
        const stagedKeys = new Set([...rawParts, ...rawLabor].map((row) => row.legacyRowKey));
        const missing = [...resolutionContext.plan.rowActions.keys()].filter((key) => !stagedKeys.has(key));
        if (missing.length) throw new Error("Final-cutover active-RO resolution rows do not match staged open-order rows.");
      }
      const [shop, finalizedInvoices, survivingRepairOrders] = await Promise.all([
        prisma.shop.findUniqueOrThrow({ where: { id: SHOP_ID }, select: {
          nextRepairOrderNumber: true, defaultTaxRate: true, partsTaxable: true, laborTaxable: true,
          shopSuppliesEnabled: true, shopSuppliesRate: true, shopSuppliesCap: true, shopSuppliesTaxable: true,
        } }),
        prisma.invoice.findMany({ where: { shopId: SHOP_ID }, select: { legacyRoNo: true, repairOrderNumber: true, customerId: true, vehicleId: true } }),
        prisma.repairOrder.findMany({ where: { shopId: SHOP_ID }, select: { id: true, repairOrderNumber: true } }),
      ]);
      const projection = projectFinalCutoverOpenOrders({
        partRows: rawParts, laborRows: rawLabor, customers, vehicles, finalizedInvoices,
        survivingRepairOrders, shopSettings: shop, currentNextRepairOrderNumber: shop.nextRepairOrderNumber,
        adjudicationPlan: adjudicationContext?.plan ?? null,
        resolutionPlan: resolutionContext?.plan ?? null,
      });
      if (projection.fatalIssues.length) {
        const first = projection.fatalIssues[0];
        throw new Error(`Final-cutover active Repair Order acceptance failed: ${first.code} for RO ${first.legacyRoNo}.`);
      }
      let persistedNextRepairOrderNumber = projection.nextRepairOrderNumber;
      await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT id FROM shops
          WHERE id = ${SHOP_ID}::uuid
          FOR UPDATE
        `;
        for (const projected of projection.orders) {
          const { parts, labor, ...orderData } = projected;
          const repairOrder = await transaction.repairOrder.upsert({
            where: { shopId_legacyRoNo: { shopId: SHOP_ID, legacyRoNo: projected.legacyRoNo } },
            create: { shopId: SHOP_ID, ...orderData }, update: orderData, select: { id: true },
          });
          for (const line of parts) await transaction.repairOrderPart.upsert({
            where: { shopId_legacyLineKey: { shopId: SHOP_ID, legacyLineKey: line.legacyLineKey } },
            create: { shopId: SHOP_ID, repairOrderId: repairOrder.id, ...line },
            update: { repairOrderId: repairOrder.id, ...line },
          });
          for (const line of labor) await transaction.repairOrderLabor.upsert({
            where: { shopId_legacyLineKey: { shopId: SHOP_ID, legacyLineKey: line.legacyLineKey } },
            create: { shopId: SHOP_ID, repairOrderId: repairOrder.id, ...line },
            update: { repairOrderId: repairOrder.id, ...line },
          });
        }
        const currentShop = await transaction.shop.findUniqueOrThrow({ where: { id: SHOP_ID }, select: { nextRepairOrderNumber: true } });
        const nextRepairOrderNumber = Math.max(currentShop.nextRepairOrderNumber, projection.nextRepairOrderNumber);
        persistedNextRepairOrderNumber = nextRepairOrderNumber;
        if (nextRepairOrderNumber > currentShop.nextRepairOrderNumber) await transaction.shop.update({
          where: { id: SHOP_ID }, data: { nextRepairOrderNumber },
        });
      }, { maxWait: 10_000, timeout: 120_000 });
      console.log(`operational final-cutover open orders: ${projection.orders.length}`);
      console.log(`reviewed stale active ROs excluded: ${projection.reviewedExclusions.length}`);
      console.log(`reviewed stale source rows excluded: ${projection.reviewedExclusions.reduce((sum, decision) => sum + decision.sourceRows, 0)}`);
      if (projection.adjudicationManifestFingerprint) console.log(`active-RO adjudication manifest SHA-256: ${projection.adjudicationManifestFingerprint}`);
      console.log(`reviewed active ROs resolved: ${projection.reviewedResolutions.length}`);
      console.log(`reviewed structural source rows excluded: ${projection.reviewedResolutions.reduce((sum, decision) => sum + decision.excludedStructuralSourceRows, 0)}`);
      if (projection.resolutionManifestFingerprint) console.log(`active-RO resolution manifest SHA-256: ${projection.resolutionManifestFingerprint}`);
      console.log(`next Repair Order number: ${persistedNextRepairOrderNumber}`);
      console.log("validation issues: 0");
      return;
    }

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
      const odometer = normalizeLegacyOdometer(header.rawData?.ODOMETER);
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
          vendorNameSnapshot: textValue(row.rawData, "SOURCE"),
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
