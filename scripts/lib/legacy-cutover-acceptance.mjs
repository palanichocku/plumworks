import { buildInvoicePartVendorBackfillPlan, projectLegacyFinalPartLines } from "./invoice-part-vendor-backfill.mjs";
import { normalizeLegacyOdometer, projectInvoiceOdometerBackfill } from "./legacy-odometer.mjs";

function text(rawData, field) {
  const value = rawData && typeof rawData === "object" ? rawData[field] : null;
  const normalized = value === null || value === undefined ? "" : String(value).trim();
  return normalized || null;
}

function groupOpenOrders(partRows, laborRows, customerIds, vehicleIds) {
  const groups = new Map();
  for (const [kind, rows] of [["parts", partRows], ["labor", laborRows]]) for (const row of rows) {
    const legacyRoNo = row.legacyRoNo?.trim();
    if (!legacyRoNo) continue;
    const group = groups.get(legacyRoNo) ?? { parts: [], labor: [] };
    group[kind].push(row);
    groups.set(legacyRoNo, group);
  }
  const orders = [];
  for (const [legacyRoNo, group] of groups) {
    const header = group.parts[0] ?? group.labor[0];
    const legacyCustno = header.legacyCustno ?? group.labor.find((row) => row.legacyCustno)?.legacyCustno;
    const legacyCarno = header.legacyCarno ?? group.labor.find((row) => row.legacyCarno)?.legacyCarno;
    if (!customerIds.has(legacyCustno) || !vehicleIds.has(legacyCarno)) continue;
    orders.push({
      id: `legacy-open:${legacyRoNo}`, legacyRoNo, status: "open", legacySourceTable: "orders/LABORorder",
      invoiceId: null, odometer: normalizeLegacyOdometer(header.rawData?.ODOMETER),
      parts: group.parts.map((row) => ({ legacyLineKey: row.legacyRowKey, vendorNameSnapshot: text(row.rawData, "SOURCE") })),
      labor: group.labor.map(() => ({ complimentary: false })),
    });
  }
  return orders;
}

export function verifyFreshLegacyCutover({ shopId, rawAr, rawFinal, openPartRows, openLaborRows, invoiceProjection, customerIds, vehicleIds }) {
  const scopedAr = rawAr.map((row) => ({ ...row, shopId }));
  const invoiceOdometer = projectInvoiceOdometerBackfill({ shopId, rawRows: scopedAr, invoices: invoiceProjection.invoices });
  const completedSourceRows = rawAr.filter((row) => row.shopId === shopId || row.shopId === undefined);
  const completedNonblank = completedSourceRows.filter((row) => text(row.rawData, "ODOMETER"));
  const completedNormalized = completedSourceRows.filter((row) => normalizeLegacyOdometer(row.rawData?.ODOMETER) !== null);
  const invoiceByRo = new Map(invoiceProjection.invoices.map((invoice) => [invoice.legacyRoNo, invoice]));
  const normalizedByRo = new Map();
  for (const row of completedSourceRows) {
    const legacyRoNo = row.legacyRoNo?.trim();
    if (!legacyRoNo) continue;
    const values = normalizedByRo.get(legacyRoNo) ?? new Set();
    const value = normalizeLegacyOdometer(row.rawData?.ODOMETER);
    if (value !== null) values.add(value);
    normalizedByRo.set(legacyRoNo, values);
  }
  const completedInvalidWithDestinationValue = [...normalizedByRo].filter(([legacyRoNo, values]) => {
    const invoice = invoiceByRo.get(legacyRoNo);
    return values.size === 0 && invoice && invoice.odometer !== null;
  }).length;

  const sourceParts = projectLegacyFinalPartLines(rawFinal).filter((line) => invoiceByRo.has(line.legacyRoNo));
  const vendorPlan = buildInvoicePartVendorBackfillPlan(sourceParts, invoiceProjection.parts);
  const openOrders = groupOpenOrders(openPartRows, openLaborRows, customerIds, vehicleIds);
  const openSourceMileage = openOrders.filter((order) => order.odometer !== null).length;
  const openInvalidMileage = openOrders.filter((order) => order.odometer === null).length;
  const openPartLines = openOrders.flatMap((order) => order.parts);
  const openVendorValues = openPartLines.filter((part) => part.vendorNameSnapshot !== null).length;
  const importedLabor = invoiceProjection.labor.length + openOrders.reduce((sum, order) => sum + order.labor.length, 0);
  const producedComplimentary = invoiceProjection.labor.filter((row) => row.complimentary).length + openOrders.flatMap((order) => order.labor).filter((row) => row.complimentary).length;

  const mileage = {
    completedSourceRows: completedNonblank.length,
    completedNormalizedValues: completedNormalized.length,
    completedDestinationMatches: invoiceOdometer.alreadyCorrect,
    completedMismatches: invoiceOdometer.proposedUpdates + completedInvalidWithDestinationValue,
    completedInvalidOrUnavailable: completedSourceRows.length - completedNormalized.length,
    openSourceValues: openSourceMileage,
    openDestinationMatches: openSourceMileage,
    openInvalidOrUnavailable: openInvalidMileage,
    unresolved: invoiceOdometer.unresolved,
    ambiguous: invoiceOdometer.ambiguous,
  };
  const vendor = {
    completedSourcePartLines: sourceParts.length,
    completedSourceValues: vendorPlan.sourceVendorValues,
    completedExactDestinationMatches: vendorPlan.alreadyCorrect,
    completedMismatches: vendorPlan.proposedUpdates + vendorPlan.conflicts,
    openPartLines: openPartLines.length,
    openSourceValues: openVendorValues,
    openMatches: openVendorValues,
    missingValues: vendorPlan.missingSourceVendor + (openPartLines.length - openVendorValues),
    unresolved: vendorPlan.unresolved,
    ambiguous: vendorPlan.ambiguous,
  };
  const complimentary = { importedLegacyLaborRows: importedLabor, expectedComplimentary: 0, producedComplimentary, unexpectedClassifications: producedComplimentary };
  const operational = { importedHistoricalOrders: openOrders.length, historicalDirectDetailEligible: openOrders.length, operationallyEligibleImportedOrders: 0, predicate: "shop + draft/open + legacySourceTable null + no Invoice" };
  const history = { invoiceMileageRecords: invoiceProjection.invoices.filter((row) => row.odometer !== null).length, invoiceVendorRecords: invoiceProjection.parts.filter((row) => row.vendorNameSnapshot !== null).length, openOrderMileageRecords: openSourceMileage, openOrderVendorRecords: openVendorValues, invoiceRepairOrderDeduplication: "unchanged", exactScope: "shop/customer/vehicle", orderingAndPagination: "unchanged" };
  const recoveryBackfill = {
    invoiceOdometer: { proposedUpdates: invoiceOdometer.proposedUpdates, conflicts: 0, unresolved: invoiceOdometer.unresolved, ambiguous: invoiceOdometer.ambiguous },
    invoicePartVendor: { proposedUpdates: vendorPlan.proposedUpdates, conflicts: vendorPlan.conflicts, unresolved: vendorPlan.unresolved, ambiguous: vendorPlan.ambiguous },
    databaseWrites: 0,
  };
  const blocking = mileage.completedMismatches + mileage.unresolved + mileage.ambiguous + vendor.completedMismatches + vendor.unresolved + vendor.ambiguous + complimentary.unexpectedClassifications + recoveryBackfill.invoiceOdometer.proposedUpdates + recoveryBackfill.invoicePartVendor.proposedUpdates;
  return { mileage, vendor, complimentary, operational, history, recoveryBackfill, blockingIssues: blocking };
}
