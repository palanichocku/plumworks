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
  legacyChargeSynchronization,
  mapLegacyInvoiceFinancials,
} from "./lib/legacy-invoice-financials.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SHOP_ID = argument("--shop-id");
if (!SHOP_ID) throw new Error("--shop-id is required.");

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

function report(counts) {
  if (counts.dryRun) {
    console.log(`invoices to insert: ${counts.invoicesInserted}`);
    console.log(`invoices to update: ${counts.invoicesUpdated}`);
    console.log(`labor-only invoices recovered: ${counts.laborOnlyRecovered}`);
    console.log(`invoice dates corrected: ${counts.invoiceDatesCorrected}`);
    console.log(`taxTotal values corrected: ${counts.taxTotalsCorrected}`);
    console.log(`shopSuppliesAmount values populated: ${counts.shopSuppliesAmountsPopulated}`);
    console.log(`historical snapshot values populated: ${counts.snapshotsPopulated}`);
    console.log(`historical snapshot values left null: ${counts.snapshotsLeftNull}`);
    console.log(`legacy charge rows to insert: ${counts.legacyChargesInserted}`);
    console.log(`legacy charge rows to update: ${counts.legacyChargesUpdated}`);
    console.log(`legacy charge rows to delete: ${counts.legacyChargesDeleted}`);
    console.log(`part lines to insert/update: ${counts.parts}`);
    console.log(`labor lines to insert/update: ${counts.labor}`);
    console.log(`AR rows to insert/update: ${counts.ar}`);
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
  console.log(`candidate orders: ${counts.candidateOrders}`);
  console.log(`orders still skipped: ${counts.ordersSkipped}`);
  console.log(`orders lacking authoritative AR totals: ${counts.missingAuthoritativeAr}`);
  console.log(`orders with invalid or missing completed dates: ${counts.invalidDates}`);
  console.log(`duplicate AR order numbers: ${counts.duplicateArOrders}`);
  console.log(`conflicting AR source records: ${counts.conflictingArRecords}`);
  console.log(`AR completed-date conflicts: ${counts.dateConflicts}`);
  console.log(`skipped records: ${counts.skipped}`);
  console.log(`validation issue count: ${counts.validationIssues}`);
  console.log(`missing customer link count: ${counts.missingCustomers}`);
  console.log(`missing vehicle link count: ${counts.missingVehicles}`);
  console.log(`reconciliation exact matches: ${counts.reconciliationMatches}`);
  console.log(`reconciliation mismatches: ${counts.reconciliationMismatches}`);
  console.log(`reconciliation variance: ${centsToDecimal(counts.reconciliationVarianceCents)}`);
  console.log(`orders with missing or malformed financial fields: ${counts.malformedFinancialOrders}`);
  for (const [period, totals] of Object.entries(counts.periodTotals)) {
    console.log(`${period} invoice count: ${totals.count}`);
    console.log(`${period} gross sales: ${centsToDecimal(totals.totalCents)}`);
    console.log(`${period} parts: ${centsToDecimal(totals.partsCents)}`);
    console.log(`${period} labor: ${centsToDecimal(totals.laborCents)}`);
    console.log(`${period} shop supplies: ${centsToDecimal(totals.shopSuppliesCents)}`);
    console.log(`${period} ordinary sales tax: ${centsToDecimal(totals.salesTaxCents)}`);
    console.log(`${period} TAX3-TAX6 legacy charges: ${centsToDecimal(totals.legacyChargesCents)}`);
    console.log(`${period} discounts/reductions: ${centsToDecimal(totals.discountsCents)}`);
    console.log(`${period} paid total: ${centsToDecimal(totals.paidCents)}`);
  }
}

function emptyPeriodTotals() {
  return {
    count: 0, totalCents: 0, partsCents: 0, laborCents: 0,
    shopSuppliesCents: 0, salesTaxCents: 0, legacyChargesCents: 0,
    discountsCents: 0, paidCents: 0,
  };
}

function addPeriodTotals(totals, financials) {
  totals.count += 1;
  totals.totalCents += financials.totalCents;
  totals.partsCents += financials.partsCents;
  totals.laborCents += financials.laborCents;
  totals.shopSuppliesCents += financials.shopSuppliesCents;
  totals.salesTaxCents += financials.salesTaxCents;
  totals.legacyChargesCents += financials.legacyAdditionalChargesCents;
  totals.discountsCents += financials.discountsCents;
  totals.paidCents += financials.paidCents;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const dryRun = process.argv.includes("--dry-run");
  const laborOnly = process.argv.includes("--labor-only");
  const headersOnly = process.argv.includes("--headers-only");
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
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
        reconciliationMatches: 0,
        reconciliationMismatches: 0,
        reconciliationVarianceCents: 0,
        malformedFinancialOrders: 0,
        periodTotals: {},
      });
      return;
    }

    const [rawFinal, rawLabor, rawAr, customers, vehicles] = await Promise.all([
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
      prisma.vehicle.findMany({
        where: { shopId: SHOP_ID, legacyCarno: { not: null } },
        select: { id: true, legacyCarno: true },
      }),
    ]);

    const customerIds = new Map(
      customers.map((customer) => [customer.legacyCustno, customer.id]),
    );
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
    const reportableInvoices = [];
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
        continue;
      }
      const arRow = arRows[0];
      const financials = mapLegacyInvoiceFinancials(arRow.rawData);
      if (!financials.valid) {
        malformedFinancialOrders += 1;
        continue;
      }
      if (!financials.reconciliation.reconciles) {
        reconciliationMismatches += 1;
        reconciliationVarianceCents += financials.reconciliation.varianceCents;
        continue;
      }
      reconciliationMatches += 1;
      const customerId = arRow.legacyCustno
        ? customerIds.get(arRow.legacyCustno)
        : null;
      const legacyCarno = arRow.legacyCarno ??
        finalRows.find((row) => row.legacyCarno)?.legacyCarno ??
        laborRows.find((row) => row.legacyCarno)?.legacyCarno;
      const vehicleId = legacyCarno ? vehicleIds.get(legacyCarno) : null;
      const selectedDate = selectLegacyInvoiceDate({ arRows, finalRows, laborRows });
      if (selectedDate.missingCompletedDate || selectedDate.invalidDates.length > 0) invalidDates += 1;
      if (selectedDate.conflicts.length > 0) dateConflicts += 1;
      if (!selectedDate.date) continue;
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
      reportableInvoices.push(link);
      if (!customerId) {
        missingCustomers += 1;
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
    const existingInvoices = await prisma.invoice.findMany({
      where: { shopId: SHOP_ID, legacyRoNo: { in: [...validInvoices.keys()] } },
      select: {
        id: true,
        legacyRoNo: true,
        invoiceDate: true,
        taxTotal: true,
        shopSuppliesAmount: true,
      },
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
    const existingCharges = existingInvoices.length === 0
      ? []
      : await prisma.invoiceLegacyCharge.findMany({
          where: { invoiceId: { in: existingInvoices.map((invoice) => invoice.id) } },
          select: { invoiceId: true, sourceBucket: true, amount: true },
        });
    const existingChargesByInvoice = new Map();
    for (const charge of existingCharges) {
      const charges = existingChargesByInvoice.get(charge.invoiceId) ?? [];
      charges.push(charge);
      existingChargesByInvoice.set(charge.invoiceId, charges);
    }
    let legacyChargesInserted = 0;
    let legacyChargesUpdated = 0;
    let legacyChargesDeleted = 0;
    for (const [ro, link] of validInvoices) {
      const invoiceId = existingByRo.get(ro)?.id;
      const synchronization = legacyChargeSynchronization(
        invoiceId ? existingChargesByInvoice.get(invoiceId) ?? [] : [],
        link.financials.legacyAdditionalCharges,
      );
      legacyChargesInserted += synchronization.inserts.length;
      legacyChargesUpdated += synchronization.updates.length;
      legacyChargesDeleted += synchronization.deletes.length;
    }
    const periodTotals = {
      "all": emptyPeriodTotals(),
      "2025": emptyPeriodTotals(),
      "2026-H1": emptyPeriodTotals(),
      "2026-01": emptyPeriodTotals(),
    };
    for (const link of reportableInvoices) {
      addPeriodTotals(periodTotals.all, link.financials);
      const time = link.invoiceDate.getTime();
      if (time >= Date.UTC(2025, 0, 1) && time < Date.UTC(2026, 0, 1)) {
        addPeriodTotals(periodTotals["2025"], link.financials);
      }
      if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 6, 1)) {
        addPeriodTotals(periodTotals["2026-H1"], link.financials);
      }
      if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 1, 1)) {
        addPeriodTotals(periodTotals["2026-01"], link.financials);
      }
    }
    const counts = {
      dryRun,
      invoices: validInvoices.size,
      invoicesInserted: validInvoices.size - existingInvoices.length,
      invoicesUpdated: existingInvoices.length,
      laborOnlyRecovered,
      invoiceDatesCorrected,
      taxTotalsCorrected,
      shopSuppliesAmountsPopulated,
      snapshotsPopulated,
      snapshotsLeftNull,
      legacyChargesInserted,
      legacyChargesUpdated,
      legacyChargesDeleted,
      parts: keyedParts.length,
      labor: keyedLabor.length,
      ar: validAr.length,
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
      periodTotals,
    };

    if (dryRun) {
      report(counts);
      return;
    }

    await prisma.$transaction(async (transaction) => {
    const [existingParts, existingLabor, existingAr] =
      await Promise.all([
        transaction.invoicePart.findMany({
          where: {
            shopId: SHOP_ID,
            legacyLineKey: { in: keyedParts.map((row) => row.lineKey) },
          },
          select: { legacyLineKey: true },
        }),
        transaction.invoiceLabor.findMany({
          where: {
            shopId: SHOP_ID,
            legacyLineKey: { in: keyedLabor.map((row) => row.lineKey) },
          },
          select: { legacyLineKey: true },
        }),
        transaction.accountReceivable.findMany({
          where: {
            shopId: SHOP_ID,
            legacyRoNo: { in: validAr.map(([ro]) => ro) },
          },
          select: { legacyRoNo: true },
        }),
      ]);
    counts.partsUpdated = existingParts.length;
    counts.partsInserted = counts.parts - counts.partsUpdated;
    counts.laborUpdated = existingLabor.length;
    counts.laborInserted = counts.labor - counts.laborUpdated;
    counts.arUpdated = existingAr.length;
    counts.arInserted = counts.ar - counts.arUpdated;

    const invoiceIds = new Map();
    const invoiceColumns = [
      "shop_id", "customer_id", "vehicle_id", "status", "invoice_date",
      "parts_total", "labor_total", "subtotal", "tax_total", "total",
      "paid_total", "shop_supplies_amount", "shop_supplies_enabled_snapshot",
      "shop_supplies_rate_snapshot", "shop_supplies_cap_snapshot",
      "shop_supplies_taxable_snapshot", "shop_supplies_eligible_labor_total",
      "shop_supplies_calculated_amount", "shop_supplies_was_overridden",
      "legacy_ro_no", "legacy_source_table",
    ];
    if (laborOnly) {
      const invoices = await transaction.invoice.findMany({
        where: {
          shopId: SHOP_ID,
          legacyRoNo: { in: [...validInvoices.keys()] },
        },
        select: { id: true, legacyRoNo: true },
      });
      for (const invoice of invoices) {
        if (invoice.legacyRoNo) invoiceIds.set(invoice.legacyRoNo, invoice.id);
      }
    } else {
      for (const batch of chunks([...validInvoices])) {
        const rows = batch.map(([ro, link]) => {
          const amounts = link.financials;
          const snapshot = link.shopSuppliesSnapshot;
          return [
            SHOP_ID, link.customerId, link.vehicleId,
            amounts.balanceCents <= 0 ? "paid" : "open",
            link.invoiceDate, centsToDecimal(amounts.partsCents),
            centsToDecimal(amounts.laborCents), centsToDecimal(amounts.subtotalCents),
            centsToDecimal(amounts.salesTaxCents), centsToDecimal(amounts.totalCents),
            centsToDecimal(amounts.paidCents), centsToDecimal(amounts.shopSuppliesCents),
            snapshot.enabled,
            snapshot.rateBasisPoints === null ? null : (snapshot.rateBasisPoints / 10_000).toFixed(6),
            snapshot.capCents === null ? null : centsToDecimal(snapshot.capCents),
            snapshot.taxable,
            snapshot.eligibleLaborCents === null ? null : centsToDecimal(snapshot.eligibleLaborCents),
            snapshot.calculatedAmountCents === null ? null : centsToDecimal(snapshot.calculatedAmountCents),
            false, ro, "ar.DBF",
          ];
        });
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
      const transformedInvoiceIds = [...invoiceIds.values()];
      await transaction.invoiceLegacyCharge.deleteMany({
        where: { invoiceId: { in: transformedInvoiceIds } },
      });
      const desiredCharges = [...validInvoices].flatMap(([ro, link]) =>
        link.financials.legacyAdditionalCharges.map((charge) => ({
          invoiceId: invoiceIds.get(ro),
          sourceBucket: charge.sourceBucket,
          amount: centsToDecimal(charge.amountCents),
          sourceLabel: charge.sourceLabel,
          taxable: charge.taxable,
          legacySourceTable: charge.legacySourceTable,
        })),
      );
      for (const batch of chunks(desiredCharges)) {
        await transaction.invoiceLegacyCharge.createMany({ data: batch });
      }
    }

    const partColumns = [
      "shop_id", "invoice_id", "description", "part_number", "quantity",
      "unit_price", "legacy_line_key", "legacy_ro_no", "legacy_source_table",
    ];
    for (const batch of laborOnly || headersOnly ? [] : chunks(keyedParts)) {
      const rows = batch.map((row) => [
        SHOP_ID, invoiceIds.get(row.legacyRoNo),
        textValue(row.rawData, "DESC") ?? textValue(row.rawData, "PARTNO") ?? "Legacy part",
        textValue(row.rawData, "PARTNO"), quantity(textValue(row.rawData, "QTY")),
        decimal(textValue(row.rawData, "PRICE")), row.lineKey, row.legacyRoNo, "FINAL.DBF",
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
    for (const batch of headersOnly ? [] : chunks(keyedLabor)) {
      const rows = batch.map((row) => [
        SHOP_ID, invoiceIds.get(row.legacyRoNo),
        textValue(row.rawData, "LABOR_DONE") ??
          textValue(row.rawData, "NOTE") ??
          textValue(row.rawData, "JOBDESC") ??
          textValue(row.rawData, "CODE") ??
          "Legacy labor",
        decimal(textValue(row.rawData, "HOURS")), decimal(textValue(row.rawData, "LABORRATE")),
        row.lineKey, row.legacyRoNo, "laborfinal.DBF",
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
    for (const batch of laborOnly ? [] : chunks(validAr)) {
      const rows = batch.map(([ro, row]) => {
        const amounts = validInvoices.get(ro).financials;
        return [
          SHOP_ID, invoiceIds.get(ro), customerIds.get(row.legacyCustno),
          centsToDecimal(amounts.balanceCents), amounts.balanceCents <= 0 ? "paid" : "open", ro,
          "ar.DBF",
        ];
      });
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

    report(counts);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
