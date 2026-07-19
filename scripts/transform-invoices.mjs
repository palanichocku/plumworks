import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  groupRowsByRo,
  selectLegacyInvoiceDate,
  textValue,
} from "./lib/legacy-invoice-reconciliation.mjs";

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

function numberValue(rawData, field) {
  const rawValue = textValue(rawData, field);
  if (!rawValue) return null;
  const cleaned = rawValue.replaceAll(/[^0-9.-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function arAmounts(rawData) {
  const parts = numberValue(rawData, "PARTS") ?? 0;
  const labor = numberValue(rawData, "LABOR") ?? 0;
  const tax = ["TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6"].reduce(
    (sum, field) => sum + (numberValue(rawData, field) ?? 0),
    0,
  );
  const total = numberValue(rawData, "TOTAL") ?? parts + labor + tax;
  const paid = numberValue(rawData, "PAYMENT") ?? 0;
  const balance = numberValue(rawData, "BALANCE") ?? total - paid;
  return { parts, labor, subtotal: parts + labor, tax, total, paid, balance };
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
  if (counts.period) {
    console.log(`${counts.period} invoice count: ${counts.periodTotals.count}`);
    console.log(`${counts.period} gross sales: ${counts.periodTotals.total.toFixed(2)}`);
    console.log(`${counts.period} parts: ${counts.periodTotals.parts.toFixed(2)}`);
    console.log(`${counts.period} labor: ${counts.periodTotals.labor.toFixed(2)}`);
    console.log(`${counts.period} combined tax: ${counts.periodTotals.tax.toFixed(2)}`);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const dryRun = process.argv.includes("--dry-run");
  const laborOnly = process.argv.includes("--labor-only");
  const headersOnly = process.argv.includes("--headers-only");
  const reportMonth = argument("--report-month");
  if (reportMonth && !/^\d{4}-\d{2}$/.test(reportMonth)) {
    throw new Error("--report-month must use YYYY-MM.");
  }
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
    let missingCustomers = 0;
    let missingVehicles = 0;
    let missingAuthoritativeAr = 0;
    let invalidDates = 0;
    let duplicateArOrders = 0;
    let conflictingArRecords = 0;
    let dateConflicts = 0;
    let laborOnlyRecovered = 0;

    for (const ro of candidateOrderNumbers) {
      const arRows = arGroups.get(ro) ?? [];
      const finalRows = finalGroups.get(ro) ?? [];
      const laborRows = laborGroups.get(ro) ?? [];
      const hasAuthoritativeTotals = arRows.length > 0 && arRows.every((row) =>
        ["PARTS", "LABOR", "TOTAL"].every((field) => numberValue(row.rawData, field) !== null)
      );
      if (!hasAuthoritativeTotals) {
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
      const customerId = arRow.legacyCustno
        ? customerIds.get(arRow.legacyCustno)
        : null;
      const legacyCarno = arRow.legacyCarno ??
        finalRows.find((row) => row.legacyCarno)?.legacyCarno ??
        laborRows.find((row) => row.legacyCarno)?.legacyCarno;
      const vehicleId = legacyCarno ? vehicleIds.get(legacyCarno) : null;
      if (!customerId) {
        missingCustomers += 1;
        continue;
      }
      if (!vehicleId) missingVehicles += 1;
      const selectedDate = selectLegacyInvoiceDate({ arRows, finalRows, laborRows });
      if (selectedDate.missingCompletedDate || selectedDate.invalidDates.length > 0) invalidDates += 1;
      if (selectedDate.conflicts.length > 0) dateConflicts += 1;
      if (!selectedDate.date) continue;
      if (finalRows.length === 0 && laborRows.length > 0) laborOnlyRecovered += 1;
      validInvoices.set(ro, {
        arRow,
        customerId,
        vehicleId: vehicleId ?? null,
        invoiceDate: selectedDate.date,
      });
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
      select: { legacyRoNo: true, invoiceDate: true },
    });
    const existingInvoiceDates = new Map(
      existingInvoices.map((invoice) => [invoice.legacyRoNo, invoice.invoiceDate]),
    );
    const invoiceDatesCorrected = [...validInvoices].filter(([ro, link]) =>
      existingInvoiceDates.has(ro) &&
      existingInvoiceDates.get(ro)?.getTime() !== link.invoiceDate.getTime()
    ).length;
    let periodTotals = null;
    if (reportMonth) {
      const [year, month] = reportMonth.split("-").map(Number);
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 1));
      periodTotals = [...validInvoices.values()].reduce((totals, link) => {
        if (link.invoiceDate < start || link.invoiceDate >= end) return totals;
        const amounts = arAmounts(link.arRow.rawData);
        totals.count += 1;
        totals.parts += amounts.parts;
        totals.labor += amounts.labor;
        totals.tax += amounts.tax;
        totals.total += amounts.total;
        return totals;
      }, { count: 0, parts: 0, labor: 0, tax: 0, total: 0 });
    }
    const counts = {
      dryRun,
      invoices: validInvoices.size,
      invoicesInserted: validInvoices.size - existingInvoices.length,
      invoicesUpdated: existingInvoices.length,
      laborOnlyRecovered,
      invoiceDatesCorrected,
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
        conflictingArRecords + missingCustomers,
      missingCustomers,
      missingVehicles,
      period: reportMonth,
      periodTotals,
    };

    if (dryRun) {
      report(counts);
      return;
    }

    const [existingParts, existingLabor, existingAr] =
      await Promise.all([
        prisma.invoicePart.findMany({
          where: {
            shopId: SHOP_ID,
            legacyLineKey: { in: keyedParts.map((row) => row.lineKey) },
          },
          select: { legacyLineKey: true },
        }),
        prisma.invoiceLabor.findMany({
          where: {
            shopId: SHOP_ID,
            legacyLineKey: { in: keyedLabor.map((row) => row.lineKey) },
          },
          select: { legacyLineKey: true },
        }),
        prisma.accountReceivable.findMany({
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
      "paid_total", "legacy_ro_no", "legacy_source_table",
    ];
    if (laborOnly) {
      const invoices = await prisma.invoice.findMany({
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
          const amounts = arAmounts(link.arRow.rawData);
          return [
            SHOP_ID, link.customerId, link.vehicleId,
            amounts.balance <= 0 ? "paid" : "open",
            link.invoiceDate, String(amounts.parts),
            String(amounts.labor), String(amounts.subtotal), String(amounts.tax),
            String(amounts.total), String(amounts.paid), ro, "ar.DBF",
          ];
        });
        const invoices = await prisma.$queryRawUnsafe(
          bulkUpsertSql(
            "invoices", invoiceColumns, ["shop_id", "legacy_ro_no"],
            invoiceColumns.slice(1, 11).concat("legacy_source_table"), rows.length,
            "id, legacy_ro_no",
          ),
          ...rows.flat(),
        );
        for (const invoice of invoices) {
          invoiceIds.set(invoice.legacy_ro_no, invoice.id);
        }
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
      await prisma.$executeRawUnsafe(
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
      await prisma.$executeRawUnsafe(
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
        const amounts = arAmounts(row.rawData);
        return [
          SHOP_ID, invoiceIds.get(ro), customerIds.get(row.legacyCustno),
          String(amounts.balance), amounts.balance <= 0 ? "paid" : "open", ro,
          "ar.DBF",
        ];
      });
      await prisma.$executeRawUnsafe(
        bulkUpsertSql(
          "accounts_receivable", arColumns, ["shop_id", "legacy_ro_no"],
          ["invoice_id", "customer_id", "balance", "status", "legacy_source_table"],
          rows.length,
        ),
        ...rows.flat(),
      );
    }

    report(counts);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
