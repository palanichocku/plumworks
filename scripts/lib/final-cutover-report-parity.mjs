import { mapLegacyInvoiceFinancials, parseLegacyMoneyCents } from "./legacy-invoice-financials.mjs";
import { groupRowsByRo, selectLegacyInvoiceDate } from "./legacy-invoice-reconciliation.mjs";

export const FINAL_CUTOVER_REPORT_FIELDS = Object.freeze([
  "invoiceCount",
  "partsTotalCents",
  "laborTotalCents",
  "subtotalCents",
  "shopSuppliesTotalCents",
  "ordinarySalesTaxTotalCents",
  "discountsTotalCents",
  "legacyChargeTotalCents",
  "grossSalesTotalCents",
  "invoicePaidTotalCents",
]);

export function cutoverReportPeriods(cutoverDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate ?? "")) throw new Error("--cutover-date must use YYYY-MM-DD.");
  const end = new Date(`${cutoverDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== cutoverDate) throw new Error("--cutover-date is invalid.");
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();
  return [
    {
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: `${end.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${year}`,
      start: new Date(Date.UTC(year, month, 1)),
      endExclusive,
    },
    {
      key: `${year}-YTD`,
      label: `${year} year-to-date through ${cutoverDate}`,
      start: new Date(Date.UTC(year, 0, 1)),
      endExclusive,
    },
  ];
}

export function emptyReportTotals() {
  return {
    invoiceCount: 0,
    partsTotalCents: 0,
    laborTotalCents: 0,
    subtotalCents: 0,
    shopSuppliesTotalCents: 0,
    ordinarySalesTaxTotalCents: 0,
    discountsTotalCents: 0,
    legacyChargeTotalCents: 0,
    grossSalesTotalCents: 0,
    invoicePaidTotalCents: 0,
  };
}

function addFinancials(totals, financials) {
  totals.invoiceCount += 1;
  totals.partsTotalCents += financials.partsCents;
  totals.laborTotalCents += financials.laborCents;
  totals.subtotalCents += financials.subtotalCents;
  totals.shopSuppliesTotalCents += financials.shopSuppliesCents;
  totals.ordinarySalesTaxTotalCents += financials.salesTaxCents;
  totals.discountsTotalCents += financials.discountsCents;
  totals.legacyChargeTotalCents += financials.legacyAdditionalChargesCents;
  totals.grossSalesTotalCents += financials.totalCents;
  totals.invoicePaidTotalCents += financials.paidCents;
}

function signature(row) {
  const fields = ["PARTS", "LABOR", "TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6", "TOTAL", "PAYMENT", "DISCOUNT", "DEDUCT", "BALANCE", "DATE_SOLD", "RO_DATE"];
  return JSON.stringify(fields.map((field) => row.rawData?.[field] == null ? null : String(row.rawData[field]).trim()));
}

export function projectSourceReportInvoices({ arRows, finalRows = [], laborRows = [] }) {
  const arGroups = groupRowsByRo(arRows);
  const finalGroups = groupRowsByRo(finalRows);
  const laborGroups = groupRowsByRo(laborRows);
  const invoices = [];
  const fatalIssues = [];

  for (const [legacyRoNo, groupedAr] of arGroups) {
    const signatures = new Set(groupedAr.map(signature));
    if (signatures.size !== 1) {
      fatalIssues.push({ code: "conflicting-ar-report-records", legacyRoNo });
      continue;
    }
    const financials = mapLegacyInvoiceFinancials(groupedAr[0].rawData);
    const selectedDate = selectLegacyInvoiceDate({
      arRows: groupedAr,
      finalRows: finalGroups.get(legacyRoNo) ?? [],
      laborRows: laborGroups.get(legacyRoNo) ?? [],
    });
    if (!financials.valid || !financials.reconciliation?.reconciles || !selectedDate.date) {
      fatalIssues.push({
        code: "invalid-report-projection",
        legacyRoNo,
        financialsValid: financials.valid,
        financialsReconcile: financials.reconciliation?.reconciles ?? false,
        hasInvoiceDate: Boolean(selectedDate.date),
      });
      continue;
    }
    invoices.push({ legacyRoNo, invoiceDate: selectedDate.date, financials });
  }
  return { invoices, fatalIssues };
}

export function summarizeSourcePeriod(sourceInvoices, period) {
  const totals = emptyReportTotals();
  for (const invoice of sourceInvoices) {
    if (invoice.invoiceDate < period.start || invoice.invoiceDate >= period.endExclusive) continue;
    addFinancials(totals, invoice.financials);
  }
  return totals;
}

function decimalCents(value) {
  if (value === null || value === undefined) return 0;
  const parsed = parseLegacyMoneyCents(String(value));
  if (parsed === null) throw new Error(`Unable to normalize destination money value: ${String(value)}`);
  return parsed;
}

export function summarizeDestinationInvoices(invoices) {
  const totals = emptyReportTotals();
  for (const invoice of invoices) {
    const legacyChargeTotalCents = (invoice.legacyCharges ?? []).reduce((sum, charge) => sum + decimalCents(charge.amount), 0);
    const partsTotalCents = decimalCents(invoice.partsTotal);
    const laborTotalCents = decimalCents(invoice.laborTotal);
    const subtotalCents = decimalCents(invoice.subtotal);
    const shopSuppliesTotalCents = decimalCents(invoice.shopSuppliesAmount);
    const ordinarySalesTaxTotalCents = decimalCents(invoice.taxTotal);
    const grossSalesTotalCents = decimalCents(invoice.total);
    const invoicePaidTotalCents = decimalCents(invoice.paidTotal);
    const discountsTotalCents = subtotalCents + shopSuppliesTotalCents + ordinarySalesTaxTotalCents + legacyChargeTotalCents - grossSalesTotalCents;
    totals.invoiceCount += 1;
    totals.partsTotalCents += partsTotalCents;
    totals.laborTotalCents += laborTotalCents;
    totals.subtotalCents += subtotalCents;
    totals.shopSuppliesTotalCents += shopSuppliesTotalCents;
    totals.ordinarySalesTaxTotalCents += ordinarySalesTaxTotalCents;
    totals.discountsTotalCents += discountsTotalCents;
    totals.legacyChargeTotalCents += legacyChargeTotalCents;
    totals.grossSalesTotalCents += grossSalesTotalCents;
    totals.invoicePaidTotalCents += invoicePaidTotalCents;
  }
  return totals;
}

export function compareReportTotals(source, destination) {
  return FINAL_CUTOVER_REPORT_FIELDS.flatMap((field) => source[field] === destination[field]
    ? []
    : [{ field, source: source[field], destination: destination[field], difference: destination[field] - source[field] }]);
}

export function money(cents) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
