import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  groupRowsByRo,
  selectLegacyInvoiceDate,
  textValue,
} from "./lib/legacy-invoice-reconciliation.mjs";
import {
  centsToDecimal,
  inferHistoricalShopSuppliesSnapshot,
  mapLegacyInvoiceFinancials,
} from "./lib/legacy-invoice-financials.mjs";
import {
  aliasResolutionMaps,
  resolveLegacyCustomerId,
} from "./lib/legacy-customer-recovery.mjs";
import {
  executeLegacyInvoiceWriteTransaction,
  parseLegacyInvoiceTransformerArguments,
} from "./lib/legacy-invoice-transformer-safety.mjs";
import {
  projectWritableInvoicePeriods,
  skippedOrderDiagnostic,
} from "./lib/legacy-invoice-projection.mjs";
import {
  classifyPersistedRows,
  comparePersistedRows,
  writableClassifications,
} from "./lib/legacy-invoice-change-detection.mjs";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

const options = parseLegacyInvoiceTransformerArguments(process.argv.slice(2));

function decimal(rawValue, fallback = "0") {
  if (!rawValue) return fallback;
  const cleaned = rawValue.replaceAll(/[^0-9.-]/g, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : fallback;
}

function quantity(rawValue) {
  const parsed = decimal(rawValue, "1");
  return Number(parsed) === 0 ? "1" : parsed;
}

function stableHash(rawData) {
  return createHash("sha256")
    .update(JSON.stringify(rawData))
    .digest("hex")
    .slice(0, 24);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function lineKeys(rows, source, omitFields = []) {
  const occurrences = new Map();
  return rows
    .map((row) => {
      const ro = row.legacyRoNo?.trim();
      if (!ro) return null;
      const hashData =
        row.rawData && typeof row.rawData === "object" && !Array.isArray(row.rawData)
          ? Object.fromEntries(
              Object.entries(row.rawData).filter(
                ([field]) => !omitFields.includes(field),
              ),
            )
          : row.rawData;
      const hash = stableHash(
        omitFields.length > 0 ? canonicalize(hashData) : hashData,
      );
      const occurrenceKey = `${ro}:${hash}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      return {
        ...row,
        lineKey: `${source}:${ro}:${hash}:${occurrence}`,
      };
    })
    .filter(Boolean);
}

function chunks(items, size = 200) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function bulkUpsertSql(table, columns, conflictColumns, updateColumns, rowCount, returning = "") {
  const values = Array.from({ length: rowCount }, (_, rowIndex) => {
    const placeholders = columns.map(
      (_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`,
    );
    return `(${placeholders.join(", ")})`;
  });
  const updates = updateColumns
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")} ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updates}${returning ? ` RETURNING ${returning}` : ""}`;
}

function proposedInvoiceRow(shopId, legacyRoNo, link) {
  const amounts = link.financials;
  const snapshot = link.shopSuppliesSnapshot;
  return {
    shopId, legacyRoNo, customerId: link.customerId, vehicleId: link.vehicleId,
    status: amounts.balanceCents <= 0 ? "paid" : "open", invoiceDate: link.invoiceDate,
    partsTotal: centsToDecimal(amounts.partsCents), laborTotal: centsToDecimal(amounts.laborCents),
    subtotal: centsToDecimal(amounts.subtotalCents), taxTotal: centsToDecimal(amounts.salesTaxCents),
    total: centsToDecimal(amounts.totalCents), paidTotal: centsToDecimal(amounts.paidCents),
    shopSuppliesAmount: centsToDecimal(amounts.shopSuppliesCents),
    shopSuppliesEnabledSnapshot: snapshot.enabled,
    shopSuppliesRateSnapshot: snapshot.rateBasisPoints === null ? null : (snapshot.rateBasisPoints / 10_000).toFixed(6),
    shopSuppliesCapSnapshot: snapshot.capCents === null ? null : centsToDecimal(snapshot.capCents),
    shopSuppliesTaxableSnapshot: snapshot.taxable,
    shopSuppliesEligibleLaborTotal: snapshot.eligibleLaborCents === null ? null : centsToDecimal(snapshot.eligibleLaborCents),
    shopSuppliesCalculatedAmount: snapshot.calculatedAmountCents === null ? null : centsToDecimal(snapshot.calculatedAmountCents),
    shopSuppliesWasOverridden: false, legacySourceTable: "ar.DBF",
  };
}

function proposedPartRow(shopId, invoiceId, row) {
  return {
    shopId, invoiceId, description: textValue(row.rawData, "DESC") ?? textValue(row.rawData, "PARTNO") ?? "Legacy part",
    partNumber: textValue(row.rawData, "PARTNO"), quantity: quantity(textValue(row.rawData, "QTY")),
    unitPrice: decimal(textValue(row.rawData, "PRICE")), legacyLineKey: row.lineKey,
    legacyRoNo: row.legacyRoNo, legacySourceTable: "FINAL.DBF",
  };
}

function proposedLaborRow(shopId, invoiceId, row) {
  return {
    shopId, invoiceId,
    description: textValue(row.rawData, "LABOR_DONE") ?? textValue(row.rawData, "NOTE") ??
      textValue(row.rawData, "JOBDESC") ?? textValue(row.rawData, "CODE") ?? "Legacy labor",
    hours: decimal(textValue(row.rawData, "HOURS")), hourlyRate: decimal(textValue(row.rawData, "LABORRATE")),
    legacyLineKey: row.lineKey, legacyRoNo: row.legacyRoNo, legacySourceTable: "laborfinal.DBF",
  };
}

function proposedArRow(shopId, invoiceId, legacyRoNo, row, amounts, customerIds, aliasCustomerIds) {
  return {
    shopId, invoiceId, customerId: resolveLegacyCustomerId(row.legacyCustno, customerIds, aliasCustomerIds),
    balance: centsToDecimal(amounts.balanceCents), status: amounts.balanceCents <= 0 ? "paid" : "open",
    legacyRoNo, legacySourceTable: "ar.DBF",
  };
}

function report(counts) {
  if (counts.dryRun) {
    console.log(`invoices to insert: ${counts.invoicesInserted}`);
    console.log(`invoices to update: ${counts.invoicesUpdated}`);
    console.log(`invoices unchanged: ${counts.invoicesUnchanged}`);
    console.log(`labor-only invoices recovered: ${counts.laborOnlyRecovered}`);
    console.log(`invoice dates corrected: ${counts.invoiceDatesCorrected}`);
    console.log(`taxTotal values corrected: ${counts.taxTotalsCorrected}`);
    console.log(`shopSuppliesAmount values populated: ${counts.shopSuppliesAmountsPopulated}`);
    console.log(`historical snapshot values populated: ${counts.snapshotsPopulated}`);
    console.log(`historical snapshot values left null: ${counts.snapshotsLeftNull}`);
    console.log(`part lines to insert: ${counts.partsInserted}`);
    console.log(`part lines to update: ${counts.partsUpdated}`);
    console.log(`part lines unchanged: ${counts.partsUnchanged}`);
    console.log(`part lines to delete: ${counts.partsDeleted}`);
    console.log(`labor lines to insert: ${counts.laborInserted}`);
    console.log(`labor lines to update: ${counts.laborUpdated}`);
    console.log(`labor lines unchanged: ${counts.laborUnchanged}`);
    console.log(`labor lines to delete: ${counts.laborDeleted}`);
    console.log(`AR rows to insert: ${counts.arInserted}`);
    console.log(`AR rows to update: ${counts.arUpdated}`);
    console.log(`AR rows unchanged: ${counts.arUnchanged}`);
    console.log(`AR rows to delete: ${counts.arDeleted}`);
  } else {
    console.log(`invoices inserted: ${counts.invoicesInserted}`);
    console.log(`invoices updated: ${counts.invoicesUpdated}`);
    console.log(`part lines inserted: ${counts.partsInserted}`);
    console.log(`part lines updated: ${counts.partsUpdated}`);
    console.log(`labor lines inserted: ${counts.laborInserted}`);
    console.log(`labor lines updated: ${counts.laborUpdated}`);
    console.log(`AR rows inserted: ${counts.arInserted}`);
    console.log(`AR rows updated: ${counts.arUpdated}`);
  }
  console.log(`database writes performed: ${counts.databaseWrites ?? 0}`);
  console.log(`invoice inserts: ${counts.invoicesInserted}`);
  console.log(`invoice updates: ${counts.invoicesUpdated}`);
  console.log(`invoice unchanged: ${counts.invoicesUnchanged}`);
  for (const [reason, count] of Object.entries(counts.invoiceUpdateReasons ?? {})) {
    console.log(`invoice update reason ${reason}: ${count}`);
  }
  console.log(`legacy charge rows to insert: ${counts.legacyChargesInserted}`);
  console.log(`legacy charge rows to update: ${counts.legacyChargesUpdated}`);
  console.log(`legacy charge rows to delete: ${counts.legacyChargesDeleted}`);
  console.log(`legacy charge rows unchanged: ${counts.legacyChargesUnchanged}`);
  console.log(`legacy charge existing rows: ${counts.legacyChargesExisting}`);
  console.log(`source candidate orders: ${counts.candidateOrders}`);
  console.log(`writable invoices: ${counts.invoices}`);
  console.log(`skipped source orders: ${counts.ordersSkipped}`);
  console.log(`orders lacking authoritative AR totals: ${counts.missingAuthoritativeAr}`);
  console.log(`orders with invalid or missing completed dates: ${counts.invalidDates}`);
  console.log(`duplicate AR order numbers: ${counts.duplicateArOrders}`);
  console.log(`conflicting AR source records: ${counts.conflictingArRecords}`);
  console.log(`AR completed-date conflicts: ${counts.dateConflicts}`);
  console.log(`legacy source rows/lines omitted from write plan: ${counts.skipped}`);
  console.log(`validation issue count: ${counts.validationIssues}`);
  console.log(`missing customer link count: ${counts.missingCustomers}`);
  console.log(`missing vehicle link count: ${counts.missingVehicles}`);
  console.log(`reconciliation exact matches: ${counts.reconciliationMatches}`);
  console.log(`reconciliation mismatches: ${counts.reconciliationMismatches}`);
  console.log(`reconciliation variance: ${centsToDecimal(counts.reconciliationVarianceCents)}`);
  console.log(`orders with missing or malformed financial fields: ${counts.malformedFinancialOrders}`);
  for (const skippedOrder of counts.skippedOrders ?? []) {
    console.log(`skipped source order ${skippedOrder.legacyRoNo}: ${skippedOrder.reason}`);
  }
  for (const [period, totals] of Object.entries(counts.periodTotals)) {
    const label = period === "all" ? "projected operational all-history" : `${period} projected operational`;
    console.log(`${label} invoice count: ${totals.count}`);
    console.log(`${period} gross sales: ${centsToDecimal(totals.totalCents)}`);
    console.log(`${period} parts: ${centsToDecimal(totals.partsCents)}`);
    console.log(`${period} labor: ${centsToDecimal(totals.laborCents)}`);
    console.log(`${period} subtotal: ${centsToDecimal(totals.subtotalCents)}`);
    console.log(`${period} shop supplies: ${centsToDecimal(totals.shopSuppliesCents)}`);
    console.log(`${period} ordinary sales tax: ${centsToDecimal(totals.salesTaxCents)}`);
    console.log(`${period} TAX3-TAX6 legacy charges: ${centsToDecimal(totals.legacyChargesCents)}`);
    console.log(`${period} discounts/reductions: ${centsToDecimal(totals.discountsCents)}`);
    console.log(`${period} paid total: ${centsToDecimal(totals.paidCents)}`);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const { dryRun, confirmedWrite, laborOnly, headersOnly } = options;
  console.log(`Execution mode: ${dryRun ? "DRY RUN" : "CONFIRMED WRITE"}`);
  console.log(`Confirmation status: ${options.confirmationStatus}`);
  console.log(`Database writes permitted: ${confirmedWrite ? "yes" : "no"}`);
  console.log("Supported dry run: npm run legacy:transform:invoices");
  console.log("Supported explicit dry run: npm run legacy:transform:invoices -- --dry-run");
  console.log("Supported confirmed write: npm run legacy:transform:invoices -- --confirm TRANSFORM_LEGACY_INVOICES");
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const SHOP_ID = await resolveSingleShopId(prisma, options.shopId);
    const latest = await prisma.legacyImportRun.findFirst({
      where: {
        shopId: SHOP_ID,
        OR: [
          { rawFinal: { some: {} } },
          { rawLaborFinal: { some: {} } },
          { rawAr: { some: {} } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!latest) {
      report({
        dryRun,
        invoices: 0,
        invoicesInserted: 0,
        invoicesUpdated: 0,
        invoicesUnchanged: 0,
        laborOnlyRecovered: 0,
        invoiceDatesCorrected: 0,
        parts: 0,
        labor: 0,
        ar: 0,
        candidateOrders: 0,
        ordersSkipped: 0,
        missingAuthoritativeAr: 0,
        invalidDates: 0,
        duplicateArOrders: 0,
        conflictingArRecords: 0,
        dateConflicts: 0,
        skipped: 0,
        validationIssues: 0,
        missingCustomers: 0,
        missingVehicles: 0,
        taxTotalsCorrected: 0,
        shopSuppliesAmountsPopulated: 0,
        snapshotsPopulated: 0,
        snapshotsLeftNull: 0,
        legacyChargesInserted: 0,
        legacyChargesUpdated: 0,
        legacyChargesDeleted: 0,
        legacyChargesUnchanged: 0,
        legacyChargesExisting: 0,
        partsInserted: 0, partsUpdated: 0, partsUnchanged: 0, partsDeleted: 0,
        laborInserted: 0, laborUpdated: 0, laborUnchanged: 0, laborDeleted: 0,
        arInserted: 0, arUpdated: 0, arUnchanged: 0, arDeleted: 0,
        reconciliationMatches: 0,
        reconciliationMismatches: 0,
        reconciliationVarianceCents: 0,
        malformedFinancialOrders: 0,
        periodTotals: {},
      });
      return;
    }

    const [rawFinal, rawLabor, rawAr, customers, customerAliases, vehicles] = await Promise.all([
      prisma.rawLegacyFinal.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latest.id,
        },
        select: {
          legacyRoNo: true,
          legacyCustno: true,
          legacyCarno: true,
          rawData: true,
        },
      }),
      prisma.rawLegacyLaborFinal.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latest.id,
        },
        select: {
          legacyRoNo: true,
          legacyCustno: true,
          legacyCarno: true,
          rawData: true,
        },
      }),
      prisma.rawLegacyAr.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latest.id,
        },
        select: {
          legacyRoNo: true,
          legacyCustno: true,
          legacyCarno: true,
          rawData: true,
        },
      }),
      prisma.customer.findMany({
        where: { shopId: SHOP_ID, legacyCustno: { not: null } },
        select: { id: true, legacyCustno: true },
      }),
      prisma.customerLegacyAlias.findMany({
        where: { shopId: SHOP_ID },
        select: { customerId: true, aliasLegacyCustno: true },
      }),
      prisma.vehicle.findMany({
        where: { shopId: SHOP_ID, legacyCarno: { not: null } },
        select: { id: true, legacyCarno: true },
      }),
    ]);

    const { exactCustomerIds: customerIds, aliasCustomerIds } =
      aliasResolutionMaps(customers, customerAliases);
    const vehicleIds = new Map(
      vehicles.map((vehicle) => [vehicle.legacyCarno, vehicle.id]),
    );
    const finalGroups = groupRowsByRo(rawFinal);
    const laborGroups = groupRowsByRo(rawLabor);
    const arGroups = groupRowsByRo(rawAr);
    const candidateOrderNumbers = new Set([
      ...arGroups.keys(),
      ...finalGroups.keys(),
      ...laborGroups.keys(),
    ]);
    const validInvoices = new Map();
    const skippedOrders = [];
    let missingCustomers = 0;
    let missingVehicles = 0;
    let missingAuthoritativeAr = 0;
    let invalidDates = 0;
    let duplicateArOrders = 0;
    let conflictingArRecords = 0;
    let dateConflicts = 0;
    let laborOnlyRecovered = 0;
    let malformedFinancialOrders = 0;
    let reconciliationMatches = 0;
    let reconciliationMismatches = 0;
    let reconciliationVarianceCents = 0;

    for (const ro of candidateOrderNumbers) {
      const arRows = arGroups.get(ro) ?? [];
      const finalRows = finalGroups.get(ro) ?? [];
      const laborRows = laborGroups.get(ro) ?? [];
      if (arRows.length === 0) {
        missingAuthoritativeAr += 1;
        skippedOrders.push(skippedOrderDiagnostic(ro, "missing authoritative AR totals"));
        continue;
      }
      if (arRows.length > 1) duplicateArOrders += 1;
      const arSignatures = new Set(arRows.map((row) => JSON.stringify([
        row.legacyCustno,
        ...["PARTS", "LABOR", "TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6", "TOTAL", "PAYMENT", "BALANCE", "DATE_SOLD", "RO_DATE"]
          .map((field) => textValue(row.rawData, field)),
      ])));
      if (arSignatures.size > 1) {
        conflictingArRecords += 1;
        skippedOrders.push(skippedOrderDiagnostic(ro, "conflicting AR source records"));
        continue;
      }
      const arRow = arRows[0];
      const financials = mapLegacyInvoiceFinancials(arRow.rawData);
      if (!financials.valid) {
        malformedFinancialOrders += 1;
        skippedOrders.push(skippedOrderDiagnostic(ro, "missing or malformed financial fields"));
        continue;
      }
      if (!financials.reconciliation.reconciles) {
        reconciliationMismatches += 1;
        reconciliationVarianceCents += financials.reconciliation.varianceCents;
        skippedOrders.push(skippedOrderDiagnostic(ro, "financial reconciliation mismatch"));
        continue;
      }
      reconciliationMatches += 1;
      const customerId = resolveLegacyCustomerId(
        arRow.legacyCustno,
        customerIds,
        aliasCustomerIds,
      );
      const legacyCarno = arRow.legacyCarno ??
        finalRows.find((row) => row.legacyCarno)?.legacyCarno ??
        laborRows.find((row) => row.legacyCarno)?.legacyCarno;
      const vehicleId = legacyCarno ? vehicleIds.get(legacyCarno) : null;
      const selectedDate = selectLegacyInvoiceDate({ arRows, finalRows, laborRows });
      if (selectedDate.missingCompletedDate || selectedDate.invalidDates.length > 0) invalidDates += 1;
      if (selectedDate.conflicts.length > 0) dateConflicts += 1;
      if (!selectedDate.date) {
        skippedOrders.push(skippedOrderDiagnostic(ro, "invalid or missing completed date"));
        continue;
      }
      const shopSuppliesSnapshot = inferHistoricalShopSuppliesSnapshot({
        invoiceDate: selectedDate.date,
        laborRows,
        storedShopSuppliesCents: financials.shopSuppliesCents,
      });
      const link = {
        arRow,
        customerId,
        vehicleId: vehicleId ?? null,
        invoiceDate: selectedDate.date,
        financials,
        shopSuppliesSnapshot,
      };
      if (!customerId) {
        missingCustomers += 1;
        skippedOrders.push(skippedOrderDiagnostic(ro, "missing customer link"));
        continue;
      }
      if (finalRows.length === 0 && laborRows.length > 0) laborOnlyRecovered += 1;
      if (!vehicleId) missingVehicles += 1;
      validInvoices.set(ro, link);
    }

    const keyedParts = lineKeys(rawFinal, "FINAL").filter(
      (row) =>
        validInvoices.has(row.legacyRoNo) &&
        (textValue(row.rawData, "PARTNO") || textValue(row.rawData, "DESC")),
    );
    const keyedLabor = lineKeys(rawLabor, "laborfinal", ["NOTE"]).filter(
      (row) => validInvoices.has(row.legacyRoNo),
    );
    const validAr = [...validInvoices].map(([ro, link]) => [ro, link.arRow]);
    const skipped =
      (rawFinal.length - keyedParts.length) +
      (rawLabor.length - keyedLabor.length) +
      rawAr.filter((row) => !row.legacyRoNo?.trim()).length +
      (candidateOrderNumbers.size - validInvoices.size);
    const invoiceProposals = [...validInvoices].map(([ro, link]) => proposedInvoiceRow(SHOP_ID, ro, link));
    const existingInvoices = await prisma.invoice.findMany({
      where: { shopId: SHOP_ID, legacyRoNo: { in: [...validInvoices.keys()] } },
      select: {
        id: true, legacyRoNo: true, customerId: true, vehicleId: true, status: true,
        invoiceDate: true, partsTotal: true, laborTotal: true, subtotal: true,
        taxTotal: true, total: true, paidTotal: true, shopSuppliesAmount: true,
        shopSuppliesEnabledSnapshot: true, shopSuppliesRateSnapshot: true,
        shopSuppliesCapSnapshot: true, shopSuppliesTaxableSnapshot: true,
        shopSuppliesEligibleLaborTotal: true, shopSuppliesCalculatedAmount: true,
        shopSuppliesWasOverridden: true, legacySourceTable: true,
      },
    });
    const invoiceClassification = classifyPersistedRows({
      model: "invoice", proposedRows: invoiceProposals, existingRows: existingInvoices,
      identity: (row) => row.legacyRoNo,
    });
    const existingInvoiceDates = new Map(
      existingInvoices.map((invoice) => [invoice.legacyRoNo, invoice.invoiceDate]),
    );
    const invoiceDatesCorrected = [...validInvoices].filter(([ro, link]) =>
      existingInvoiceDates.has(ro) &&
      existingInvoiceDates.get(ro)?.getTime() !== link.invoiceDate.getTime()
    ).length;
    const existingByRo = new Map(existingInvoices.map((invoice) => [invoice.legacyRoNo, invoice]));
    const taxTotalsCorrected = [...validInvoices].filter(([ro, link]) => {
      const existing = existingByRo.get(ro);
      return existing && Math.round(Number(existing.taxTotal) * 100) !== link.financials.salesTaxCents;
    }).length;
    const shopSuppliesAmountsPopulated = [...validInvoices].filter(([ro, link]) => {
      const existing = existingByRo.get(ro);
      return existing && Math.round(Number(existing.shopSuppliesAmount) * 100) !== link.financials.shopSuppliesCents;
    }).length;
    const snapshotsPopulated = [...validInvoices.values()].filter(
      (link) => link.shopSuppliesSnapshot.enabled !== null,
    ).length;
    const snapshotsLeftNull = validInvoices.size - snapshotsPopulated;
    const existingInvoiceIds = new Map(existingInvoices.map((invoice) => [invoice.legacyRoNo, invoice.id]));
    const partProposals = keyedParts.map((row) => proposedPartRow(SHOP_ID, existingInvoiceIds.get(row.legacyRoNo) ?? null, row));
    const laborProposals = keyedLabor.map((row) => proposedLaborRow(SHOP_ID, existingInvoiceIds.get(row.legacyRoNo) ?? null, row));
    const arProposals = validAr.map(([ro, row]) => proposedArRow(
      SHOP_ID, existingInvoiceIds.get(ro) ?? null, ro, row, validInvoices.get(ro).financials,
      customerIds, aliasCustomerIds,
    ));
    const [existingParts, existingLabor, existingAr, existingCharges] = await Promise.all([
      prisma.invoicePart.findMany({
        where: { shopId: SHOP_ID, legacyLineKey: { in: partProposals.map((row) => row.legacyLineKey) } },
        select: { id:true, invoiceId:true, description:true, partNumber:true, quantity:true, unitPrice:true, legacyLineKey:true, legacyRoNo:true, legacySourceTable:true },
      }),
      prisma.invoiceLabor.findMany({
        where: { shopId: SHOP_ID, legacyLineKey: { in: laborProposals.map((row) => row.legacyLineKey) } },
        select: { id:true, invoiceId:true, description:true, hours:true, hourlyRate:true, legacyLineKey:true, legacyRoNo:true, legacySourceTable:true },
      }),
      prisma.accountReceivable.findMany({
        where: { shopId: SHOP_ID, legacyRoNo: { in: arProposals.map((row) => row.legacyRoNo) } },
        select: { id:true, invoiceId:true, customerId:true, balance:true, status:true, legacyRoNo:true, legacySourceTable:true },
      }),
      existingInvoices.length === 0 ? [] : prisma.invoiceLegacyCharge.findMany({
        where: { invoiceId: { in: existingInvoices.map((invoice) => invoice.id) } },
        select: { id:true, invoiceId:true, sourceBucket:true, amount:true, sourceLabel:true, taxable:true, legacySourceTable:true },
      }),
    ]);
    const partClassification = classifyPersistedRows({ model:"invoicePart", proposedRows:partProposals, existingRows:existingParts, identity:(row)=>row.legacyLineKey });
    const laborClassification = classifyPersistedRows({ model:"invoiceLabor", proposedRows:laborProposals, existingRows:existingLabor, identity:(row)=>row.legacyLineKey });
    const arClassification = classifyPersistedRows({ model:"accountReceivable", proposedRows:arProposals, existingRows:existingAr, identity:(row)=>row.legacyRoNo });
    const existingChargesByInvoice = new Map();
    for (const charge of existingCharges) {
      const charges = existingChargesByInvoice.get(charge.invoiceId) ?? [];
      charges.push(charge);
      existingChargesByInvoice.set(charge.invoiceId, charges);
    }
    const chargePlan = { inserts: [], updates: [], deletes: [], unchanged: [] };
    for (const [ro, link] of validInvoices) {
      const invoiceId = existingByRo.get(ro)?.id;
      const existingForInvoice = invoiceId ? existingChargesByInvoice.get(invoiceId) ?? [] : [];
      const desired = link.financials.legacyAdditionalCharges.map((charge) => ({
        invoiceId: invoiceId ?? null, legacyRoNo: ro, sourceBucket: charge.sourceBucket,
        amount: centsToDecimal(charge.amountCents), sourceLabel: charge.sourceLabel,
        taxable: charge.taxable, legacySourceTable: charge.legacySourceTable,
      }));
      const existingByBucket = new Map(existingForInvoice.map((charge) => [charge.sourceBucket, charge]));
      for (const proposed of desired) {
        const existing = existingByBucket.get(proposed.sourceBucket);
        if (!existing) chargePlan.inserts.push({ proposed, existing: null });
        else {
          const comparison = comparePersistedRows("invoiceLegacyCharge", proposed, existing);
          chargePlan[comparison.changed ? "updates" : "unchanged"].push({ proposed, existing, ...comparison });
          existingByBucket.delete(proposed.sourceBucket);
        }
      }
      chargePlan.deletes.push(...existingByBucket.values());
    }
    const invoiceUpdateReasons = Object.fromEntries([
      "financial", "invoice date", "customer/vehicle relationship", "status",
      "shop-supplies snapshot", "override metadata", "legacy source metadata",
      "other persisted fields",
    ].map((reason) => [reason, 0]));
    for (const update of invoiceClassification.updates) for (const reason of update.reasons) {
      invoiceUpdateReasons[reason] = (invoiceUpdateReasons[reason] ?? 0) + 1;
    }
    const periodTotals = projectWritableInvoicePeriods(validInvoices.values());
    const counts = {
      dryRun,
      invoices: validInvoices.size,
      invoicesInserted: invoiceClassification.inserts.length,
      invoicesUpdated: invoiceClassification.updates.length,
      invoicesUnchanged: invoiceClassification.unchanged.length,
      invoiceUpdateReasons,
      laborOnlyRecovered,
      invoiceDatesCorrected,
      taxTotalsCorrected,
      shopSuppliesAmountsPopulated,
      snapshotsPopulated,
      snapshotsLeftNull,
      legacyChargesInserted: chargePlan.inserts.length,
      legacyChargesUpdated: chargePlan.updates.length,
      legacyChargesDeleted: chargePlan.deletes.length,
      legacyChargesUnchanged: chargePlan.unchanged.length,
      legacyChargesExisting: existingCharges.length,
      parts: keyedParts.length,
      partsInserted: partClassification.inserts.length,
      partsUpdated: partClassification.updates.length,
      partsUnchanged: partClassification.unchanged.length,
      partsDeleted: 0,
      labor: keyedLabor.length,
      laborInserted: laborClassification.inserts.length,
      laborUpdated: laborClassification.updates.length,
      laborUnchanged: laborClassification.unchanged.length,
      laborDeleted: 0,
      ar: validAr.length,
      arInserted: arClassification.inserts.length,
      arUpdated: arClassification.updates.length,
      arUnchanged: arClassification.unchanged.length,
      arDeleted: 0,
      candidateOrders: candidateOrderNumbers.size,
      ordersSkipped: candidateOrderNumbers.size - validInvoices.size,
      missingAuthoritativeAr,
      invalidDates,
      duplicateArOrders,
      conflictingArRecords,
      dateConflicts,
      skipped,
      validationIssues: missingAuthoritativeAr + invalidDates + duplicateArOrders +
        conflictingArRecords + missingCustomers + malformedFinancialOrders +
        reconciliationMismatches,
      missingCustomers,
      missingVehicles,
      reconciliationMatches,
      reconciliationMismatches,
      reconciliationVarianceCents,
      malformedFinancialOrders,
      skippedOrders,
      periodTotals,
    };

    const execution = await executeLegacyInvoiceWriteTransaction({
      confirmedWrite,
      execute: async () => {
        await prisma.$transaction(async (transaction) => {
    const invoiceIds = new Map(existingInvoices.map((invoice) => [invoice.legacyRoNo, invoice.id]));
    const invoiceColumns = [
      "shop_id", "customer_id", "vehicle_id", "status", "invoice_date",
      "parts_total", "labor_total", "subtotal", "tax_total", "total",
      "paid_total", "shop_supplies_amount", "shop_supplies_enabled_snapshot",
      "shop_supplies_rate_snapshot", "shop_supplies_cap_snapshot",
      "shop_supplies_taxable_snapshot", "shop_supplies_eligible_labor_total",
      "shop_supplies_calculated_amount", "shop_supplies_was_overridden",
      "legacy_ro_no", "legacy_source_table",
    ];
    if (!laborOnly) {
      for (const batch of chunks(writableClassifications(invoiceClassification))) {
        const rows = batch.map(({ proposed: row }) => [
          row.shopId, row.customerId, row.vehicleId, row.status, row.invoiceDate,
          row.partsTotal, row.laborTotal, row.subtotal, row.taxTotal, row.total,
          row.paidTotal, row.shopSuppliesAmount, row.shopSuppliesEnabledSnapshot,
          row.shopSuppliesRateSnapshot, row.shopSuppliesCapSnapshot,
          row.shopSuppliesTaxableSnapshot, row.shopSuppliesEligibleLaborTotal,
          row.shopSuppliesCalculatedAmount, row.shopSuppliesWasOverridden,
          row.legacyRoNo, row.legacySourceTable,
        ]);
        const invoices = await transaction.$queryRawUnsafe(
          bulkUpsertSql(
            "invoices", invoiceColumns, ["shop_id", "legacy_ro_no"],
            invoiceColumns.slice(1, 19).concat("legacy_source_table"), rows.length,
            "id, legacy_ro_no",
          ),
          ...rows.flat(),
        );
        for (const invoice of invoices) {
          invoiceIds.set(invoice.legacy_ro_no, invoice.id);
        }
      }
    }

    if (!laborOnly) {
      if (chargePlan.deletes.length > 0) {
        await transaction.invoiceLegacyCharge.deleteMany({
          where: { id: { in: chargePlan.deletes.map((charge) => charge.id) } },
        });
      }
      for (const { proposed, existing } of chargePlan.updates) {
        await transaction.invoiceLegacyCharge.update({
          where: { id: existing.id },
          data: { amount: proposed.amount, sourceLabel: proposed.sourceLabel, taxable: proposed.taxable, legacySourceTable: proposed.legacySourceTable },
        });
      }
      const desiredCharges = chargePlan.inserts.map(({ proposed }) => ({
        invoiceId: invoiceIds.get(proposed.legacyRoNo), sourceBucket: proposed.sourceBucket,
        amount: proposed.amount, sourceLabel: proposed.sourceLabel, taxable: proposed.taxable,
        legacySourceTable: proposed.legacySourceTable,
      }));
      for (const batch of chunks(desiredCharges)) {
        await transaction.invoiceLegacyCharge.createMany({ data: batch });
      }
    }

    const partColumns = [
      "shop_id", "invoice_id", "description", "part_number", "quantity",
      "unit_price", "legacy_line_key", "legacy_ro_no", "legacy_source_table",
    ];
    for (const batch of laborOnly || headersOnly ? [] : chunks(writableClassifications(partClassification))) {
      const rows = batch.map(({ proposed: row }) => [
        row.shopId, invoiceIds.get(row.legacyRoNo), row.description, row.partNumber,
        row.quantity, row.unitPrice, row.legacyLineKey, row.legacyRoNo, row.legacySourceTable,
      ]);
      await transaction.$executeRawUnsafe(
        bulkUpsertSql(
          "invoice_parts", partColumns, ["shop_id", "legacy_line_key"],
          ["invoice_id", "description", "part_number", "quantity", "unit_price", "legacy_ro_no", "legacy_source_table"],
          rows.length,
        ),
        ...rows.flat(),
      );
    }

    const laborColumns = [
      "shop_id", "invoice_id", "description", "hours", "hourly_rate",
      "legacy_line_key", "legacy_ro_no", "legacy_source_table",
    ];
    for (const batch of headersOnly ? [] : chunks(writableClassifications(laborClassification))) {
      const rows = batch.map(({ proposed: row }) => [
        row.shopId, invoiceIds.get(row.legacyRoNo), row.description, row.hours, row.hourlyRate,
        row.legacyLineKey, row.legacyRoNo, row.legacySourceTable,
      ]);
      await transaction.$executeRawUnsafe(
        bulkUpsertSql(
          "invoice_labor", laborColumns, ["shop_id", "legacy_line_key"],
          ["invoice_id", "description", "hours", "hourly_rate", "legacy_ro_no", "legacy_source_table"],
          rows.length,
        ),
        ...rows.flat(),
      );
    }

    const arColumns = [
      "shop_id", "invoice_id", "customer_id", "balance", "status",
      "legacy_ro_no", "legacy_source_table",
    ];
    for (const batch of laborOnly ? [] : chunks(writableClassifications(arClassification))) {
      const rows = batch.map(({ proposed: row }) => [
        row.shopId, invoiceIds.get(row.legacyRoNo), row.customerId, row.balance, row.status,
        row.legacyRoNo, row.legacySourceTable,
      ]);
      await transaction.$executeRawUnsafe(
        bulkUpsertSql(
          "accounts_receivable", arColumns, ["shop_id", "legacy_ro_no"],
          ["invoice_id", "customer_id", "balance", "status", "legacy_source_table"],
          rows.length,
        ),
        ...rows.flat(),
      );
    }
        }, { timeout: 120_000 });
        const databaseWrites =
          (laborOnly ? 0 : counts.invoicesInserted + counts.invoicesUpdated) +
          counts.legacyChargesInserted + counts.legacyChargesUpdated +
          counts.legacyChargesDeleted + (counts.partsInserted ?? 0) +
          (counts.partsUpdated ?? 0) + (counts.laborInserted ?? 0) +
          (counts.laborUpdated ?? 0) + (counts.arInserted ?? 0) +
          (counts.arUpdated ?? 0);
        return { databaseWrites };
      },
    });
    counts.databaseWrites = execution.databaseWrites;

    report(counts);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
