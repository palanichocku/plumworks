import { normalizeLegacyOdometer } from "./legacy-odometer.mjs";
import { calculateRepairOrderEstimateTotals } from "../../src/lib/invoice-lifecycle.ts";
import { applyFinalCutoverResolution } from "./legacy-final-cutover-resolution.mjs";

export const FINAL_CUTOVER_OPEN_ORDER_FLAG = "--final-cutover-operational";
export const FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION_FLAG = "--confirm-final-cutover-open-orders";
export const FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION = "OPERATIONALIZE_FINAL_CUTOFF_REPAIR_ORDERS";

function text(rawData, field) {
  const value = rawData && typeof rawData === "object" && !Array.isArray(rawData) ? rawData[field] : null;
  return typeof value === "string" ? value.trim() || null : value == null ? null : String(value).trim() || null;
}

function number(rawData, field) {
  const value = text(rawData, field);
  if (!value) return null;
  const cleaned = value.replaceAll(/[^0-9.-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseActiveRepairOrderDate(rawData) {
  const value = text(rawData, "RO_DATE");
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getTime() === 0) return null;
  return date;
}

export function parseActiveRepairOrderNumber(value) {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null;
}

function groupRows(partRows, laborRows) {
  const groups = new Map();
  for (const [kind, rows] of [["parts", partRows], ["labor", laborRows]]) for (const row of rows) {
    const legacyRoNo = row.legacyRoNo?.trim();
    if (!legacyRoNo) continue;
    const group = groups.get(legacyRoNo) ?? { parts: [], labor: [] };
    group[kind].push(row);
    groups.set(legacyRoNo, group);
  }
  return groups;
}

function uniqueValues(rows, field) {
  return new Set(rows.map((row) => row[field]?.trim()).filter(Boolean));
}

export function projectFinalCutoverOpenOrders({
  partRows,
  laborRows,
  customers,
  vehicles,
  finalizedInvoices = [],
  survivingRepairOrders = [],
  headerRows = [],
  shopSettings,
  currentNextRepairOrderNumber,
  adjudicationPlan = null,
  resolutionPlan = null,
}) {
  ({ partRows, laborRows } = applyFinalCutoverResolution({ partRows, laborRows, resolutionPlan }));
  const excludedRowKeys = adjudicationPlan?.excludedRowKeys ?? new Set();
  const acceptedPartRows = partRows.filter((row) => !excludedRowKeys.has(row.legacyRowKey));
  const acceptedLaborRows = laborRows.filter((row) => !excludedRowKeys.has(row.legacyRowKey));
  const groups = groupRows(acceptedPartRows, acceptedLaborRows);
  const customerByLegacy = new Map(customers.map((row) => [row.legacyCustno, row.id]));
  const vehicleByLegacy = new Map(vehicles.map((row) => [row.legacyCarno, { id: row.id, customerId: row.customerId }]));
  const invoicesByRo = new Map();
  for (const invoice of finalizedInvoices) {
    const ro = invoice.legacyRoNo?.trim() ?? (Number.isInteger(invoice.repairOrderNumber) ? String(invoice.repairOrderNumber) : null);
    if (!ro) continue;
    const matches = invoicesByRo.get(ro) ?? [];
    matches.push(invoice);
    invoicesByRo.set(ro, matches);
  }
  const destinationNumbers = new Set(survivingRepairOrders.map((row) => row.repairOrderNumber).filter(Number.isInteger));
  const projectedNumbers = new Map();
  const headersByRo = new Map();
  for (const row of headerRows) {
    const matches = headersByRo.get(row.legacyRoNo) ?? [];
    matches.push(row);
    headersByRo.set(row.legacyRoNo, matches);
  }
  const orders = [];
  const fatalIssues = [];

  for (const [legacyRoNo, group] of groups) {
    const rows = [...group.parts, ...group.labor];
    const repairOrderNumber = parseActiveRepairOrderNumber(legacyRoNo);
    const customerValues = uniqueValues(rows, "legacyCustno");
    const vehicleValues = uniqueValues(rows, "legacyCarno");
    const customerLegacy = customerValues.size === 1 ? [...customerValues][0] : null;
    const vehicleLegacy = vehicleValues.size === 1 ? [...vehicleValues][0] : null;
    const customerId = customerLegacy ? customerByLegacy.get(customerLegacy) : null;
    const vehicle = vehicleLegacy ? vehicleByLegacy.get(vehicleLegacy) : null;
    const sourceHeader = group.parts[0] ?? group.labor[0];
    const matchingHeaders = headersByRo.get(legacyRoNo) ?? [];
    const openOrderHeader = matchingHeaders[0] ?? null;
    const sourceDateValues = new Set(rows.map((row) => text(row.rawData, "RO_DATE")).filter(Boolean));
    const parsedDates = rows.map((row) => parseActiveRepairOrderDate(row.rawData)).filter(Boolean);
    const openedAt = parsedDates[0] ?? null;
    const invoices = invoicesByRo.get(legacyRoNo) ?? [];
    const issues = [];

    if (repairOrderNumber === null) issues.push("invalid-active-ro-number");
    if (matchingHeaders.length > 1) issues.push("ambiguous-active-ro-header");
    if (customerValues.size !== 1 || !customerId) issues.push(customerValues.size > 1 ? "ambiguous-active-ro-customer" : "unresolved-active-ro-customer");
    if (vehicleValues.size !== 1 || !vehicle) issues.push(vehicleValues.size > 1 ? "ambiguous-active-ro-vehicle" : "unresolved-active-ro-vehicle");
    if (vehicle && customerId && vehicle.customerId !== customerId) issues.push("active-ro-customer-vehicle-mismatch");
    if (!openedAt || sourceDateValues.size !== 1 || parsedDates.some((date) => date.getTime() !== openedAt?.getTime())) issues.push("invalid-active-ro-date");
    if (invoices.length > 1) issues.push("ambiguous-finalized-invoice-collision");
    if (invoices.length) {
      issues.push("finalized-invoice-ro-number-collision");
      if (invoices.some((invoice) => {
        const sameDestinationIdentity = invoice.customerId === customerId && invoice.vehicleId === vehicle?.id;
        const sameLegacyIdentity = invoice.legacyCustno === customerLegacy && invoice.legacyCarno === vehicleLegacy;
        return sameDestinationIdentity || sameLegacyIdentity;
      })) issues.push("finalized-invoice-identity-collision");
    }
    if (repairOrderNumber !== null && destinationNumbers.has(repairOrderNumber)) issues.push("destination-repair-order-number-collision");
    if (repairOrderNumber !== null && projectedNumbers.has(repairOrderNumber)) issues.push("duplicate-projected-repair-order-number");
    if (repairOrderNumber !== null) projectedNumbers.set(repairOrderNumber, legacyRoNo);

    if (issues.length) {
      fatalIssues.push(...issues.map((code) => ({ code, legacyRoNo })));
      continue;
    }

    const parts = group.parts.map((row) => ({
      legacyLineKey: row.legacyRowKey,
      description: text(row.rawData, "DESC") ?? text(row.rawData, "PARTNO") ?? "Legacy part",
      partNumber: text(row.rawData, "PARTNO"),
      quantity: number(row.rawData, "QTY") ?? 1,
      unitPrice: number(row.rawData, "PRICE") ?? 0,
      vendorNameSnapshot: text(row.rawData, "SOURCE"),
      legacyRoNo,
      legacySourceTable: "orders",
    }));
    const labor = group.labor.map((row) => ({
      legacyLineKey: row.legacyRowKey,
      description: text(row.rawData, "LABOR_DONE") ?? text(row.rawData, "JOBDESC") ?? text(row.rawData, "CODE") ?? "Legacy labor",
      hours: number(row.rawData, "HOURS") ?? 0,
      hourlyRate: number(row.rawData, "LABORRATE") ?? 0,
      complimentary: false,
      shopSuppliesEligible: true,
      legacyRoNo,
      legacySourceTable: "LABORorder",
    }));
    const totals = calculateRepairOrderEstimateTotals({
      parts,
      labor,
      shopSuppliesEnabled: shopSettings.shopSuppliesEnabled,
      shopSuppliesRate: shopSettings.shopSuppliesRate,
      shopSuppliesCap: shopSettings.shopSuppliesCap,
      shopSuppliesTaxable: shopSettings.shopSuppliesTaxable,
      taxRate: shopSettings.defaultTaxRate,
      partsTaxable: shopSettings.partsTaxable,
      laborTaxable: shopSettings.laborTaxable,
    });
    orders.push({
      legacyRoNo, repairOrderNumber, customerId, vehicleId: vehicle.id, status: "open", openedAt,
      odometer: normalizeLegacyOdometer(sourceHeader.rawData?.ODOMETER), legacySourceTable: null,
      customerComplaint: text(openOrderHeader?.rawData, "VNOTES"),
      recommendation: text(openOrderHeader?.rawData, "RECOMEND"),
      shopSuppliesEnabledSnapshot: shopSettings.shopSuppliesEnabled,
      shopSuppliesRateSnapshot: shopSettings.shopSuppliesRate,
      shopSuppliesCapSnapshot: shopSettings.shopSuppliesCap,
      shopSuppliesTaxableSnapshot: shopSettings.shopSuppliesTaxable,
      partsTotal: totals.partsTotal, laborTotal: totals.laborTotal, taxTotal: totals.taxTotal,
      estimatedTotal: totals.total,
      shopSuppliesEligibleLaborTotal: totals.shopSuppliesEligibleLaborTotal,
      shopSuppliesCalculatedAmount: totals.shopSuppliesCalculatedAmount,
      shopSuppliesAmount: totals.shopSuppliesAmount,
      parts, labor,
    });
  }

  const highest = orders.reduce((maximum, order) => Math.max(maximum, order.repairOrderNumber), 0);
  return {
    orders,
    fatalIssues,
    reviewedExclusions: adjudicationPlan?.reviewedExclusions ?? [],
    reviewedResolutions: resolutionPlan?.reviewedResolutions ?? [],
    resolutionManifestFingerprint: resolutionPlan?.manifestFingerprint ?? null,
    adjudicationManifestFingerprint: adjudicationPlan?.manifestFingerprint ?? null,
    counts: { sourceGroups: groups.size, operationalOrders: orders.length, blockingIssues: fatalIssues.length },
    nextRepairOrderNumber: Math.max(currentNextRepairOrderNumber, highest + 1),
  };
}
