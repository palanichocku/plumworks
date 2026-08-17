import { createHash } from "node:crypto";
import { mapLegacyInvoiceFinancials } from "./legacy-invoice-financials.mjs";
import { groupRowsByRo, selectLegacyInvoiceDate, textValue } from "./legacy-invoice-reconciliation.mjs";
import { normalizeLegacyOdometer } from "./legacy-odometer.mjs";
import { projectLegacyFinalPartLines } from "./invoice-part-vendor-backfill.mjs";
import { finalizedInvoiceHeaderValues } from "./legacy-finalized-invoice-header.mjs";

export const LEGACY_INVOICE_UUID_NAMESPACE = "bc5d750a-6f87-4a77-b5ac-ae4b886410fa";

function uuidBytes(value) {
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

export function deterministicLegacyInvoiceId(shopId, legacyRoNo) {
  const bytes = createHash("sha1")
    .update(uuidBytes(LEGACY_INVOICE_UUID_NAMESPACE))
    .update(`${shopId}\n${legacyRoNo.trim()}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function projectLegacyInvoicePaymentInputs({
  shopId,
  importRunId,
  rawFinal,
  rawLabor,
  rawAr,
  resolvedCustomers,
  reviewedVehicleLinks = [],
}) {
  const customerByLegacy = new Map(resolvedCustomers.map((entry) => [entry.legacyCustno, entry.customerId]));
  const finalGroups = groupRowsByRo(rawFinal);
  const laborGroups = groupRowsByRo(rawLabor);
  const arGroups = groupRowsByRo(rawAr);
  const candidateOrders = new Set([...arGroups.keys(), ...finalGroups.keys(), ...laborGroups.keys()]);
  const invoices = [];
  const fatalIssues = [];
  const unmatched = [];
  const vehicleLinkByRo = new Map();
  for (const link of reviewedVehicleLinks) {
    if (!link?.legacyRoNo || vehicleLinkByRo.has(link.legacyRoNo)) {
      fatalIssues.push({ code: "duplicate-reviewed-vehicle-link", legacyRoNo: link?.legacyRoNo ?? null });
      continue;
    }
    vehicleLinkByRo.set(link.legacyRoNo, link);
  }
  const consumedVehicleLinks = new Set();
  for (const legacyRoNo of candidateOrders) {
    const arRows = arGroups.get(legacyRoNo) ?? [];
    const finalRows = finalGroups.get(legacyRoNo) ?? [];
    const laborRows = laborGroups.get(legacyRoNo) ?? [];
    if (arRows.length === 0) continue;
    const signatures = new Set(arRows.map((row) => JSON.stringify([
      row.legacyCustno,
      ...["PARTS", "LABOR", "TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6", "TOTAL", "PAYMENT", "BALANCE", "DATE_SOLD", "RO_DATE"]
        .map((field) => textValue(row.rawData, field)),
    ])));
    if (signatures.size > 1) {
      fatalIssues.push({ code: "conflicting-ar-records", legacyRoNo });
      continue;
    }
    const odometerValues = new Set(arRows.map((row) => normalizeLegacyOdometer(row.rawData?.ODOMETER)).filter((value) => value !== null));
    if (odometerValues.size > 1) {
      fatalIssues.push({ code: "conflicting-ar-odometer-values", legacyRoNo });
      continue;
    }
    const arRow = arRows[0];
    const header = finalizedInvoiceHeaderValues(arRow);
    const financials = mapLegacyInvoiceFinancials(arRow.rawData);
    const selectedDate = selectLegacyInvoiceDate({ arRows, finalRows, laborRows });
    const customerId = customerByLegacy.get(arRow.legacyCustno) ?? null;
    const reviewedVehicle = vehicleLinkByRo.get(legacyRoNo) ?? null;
    if (!financials.valid || !financials.reconciliation.reconciles || !selectedDate.date) {
      fatalIssues.push({ code: "invalid-invoice-projection", legacyRoNo });
      continue;
    }
    if (!customerId) {
      unmatched.push({ legacyRoNo, legacyCustno: arRow.legacyCustno, paymentCents: financials.paidCents });
      continue;
    }
    invoices.push({
      id: deterministicLegacyInvoiceId(shopId, legacyRoNo),
      shopId,
      importRunId,
      legacyRoNo,
      customerId,
      vehicleId: reviewedVehicle?.vehicleId ?? null,
      vehicleRecoveryAction: reviewedVehicle?.action ?? null,
      invoiceDate: selectedDate.date,
      odometer: odometerValues.size === 1 ? [...odometerValues][0] : null,
      customerComplaint: header.customerComplaint,
      recommendation: header.recommendation,
      total: (financials.totalCents / 100).toFixed(2),
      paidTotal: (financials.paidCents / 100).toFixed(2),
    });
    if (reviewedVehicle) consumedVehicleLinks.add(legacyRoNo);
  }
  for (const legacyRoNo of vehicleLinkByRo.keys()) {
    if (!consumedVehicleLinks.has(legacyRoNo)) fatalIssues.push({ code: "unmatched-reviewed-vehicle-link", legacyRoNo });
  }
  const invoiceIdsByRo = new Map(invoices.map((invoice) => [invoice.legacyRoNo, invoice.id]));
  const parts = projectLegacyFinalPartLines(rawFinal)
    .filter((line) => invoiceIdsByRo.has(line.legacyRoNo))
    .map((line) => ({ ...line, id: line.legacyLineKey, invoiceId: invoiceIdsByRo.get(line.legacyRoNo) }));
  const labor = rawLabor.filter((row) => invoiceIdsByRo.has(row.legacyRoNo?.trim())).map((row) => ({
    legacyRoNo: row.legacyRoNo.trim(), complimentary: false,
    description: textValue(row.rawData, "LABOR_DONE") ?? textValue(row.rawData, "NOTE") ?? textValue(row.rawData, "JOBDESC") ?? textValue(row.rawData, "CODE") ?? "Legacy labor",
    hours: textValue(row.rawData, "HOURS"), hourlyRate: textValue(row.rawData, "LABORRATE"),
  }));
  return { importRunId, invoices, parts, labor, stagedArRows: rawAr, unmatched, fatalIssues };
}

export function emptyProjectedInvoiceTotals() {
  return {
    count: 0,
    totalCents: 0,
    partsCents: 0,
    laborCents: 0,
    subtotalCents: 0,
    shopSuppliesCents: 0,
    salesTaxCents: 0,
    legacyChargesCents: 0,
    discountsCents: 0,
    paidCents: 0,
  };
}

export function addProjectedInvoice(totals, financials) {
  totals.count += 1;
  totals.totalCents += financials.totalCents;
  totals.partsCents += financials.partsCents;
  totals.laborCents += financials.laborCents;
  totals.subtotalCents += financials.subtotalCents;
  totals.shopSuppliesCents += financials.shopSuppliesCents;
  totals.salesTaxCents += financials.salesTaxCents;
  totals.legacyChargesCents += financials.legacyAdditionalChargesCents;
  totals.discountsCents += financials.discountsCents;
  totals.paidCents += financials.paidCents;
}

export function projectWritableInvoicePeriods(writableLinks) {
  const totals = {
    all: emptyProjectedInvoiceTotals(),
    "2025": emptyProjectedInvoiceTotals(),
    "2026-H1": emptyProjectedInvoiceTotals(),
    "2026-01": emptyProjectedInvoiceTotals(),
  };
  for (const link of writableLinks) {
    addProjectedInvoice(totals.all, link.financials);
    const time = link.invoiceDate.getTime();
    if (time >= Date.UTC(2025, 0, 1) && time < Date.UTC(2026, 0, 1)) addProjectedInvoice(totals["2025"], link.financials);
    if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 6, 1)) addProjectedInvoice(totals["2026-H1"], link.financials);
    if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 1, 1)) addProjectedInvoice(totals["2026-01"], link.financials);
  }
  return totals;
}

export function skippedOrderDiagnostic(legacyRoNo, reason) {
  return { legacyRoNo, reason };
}
