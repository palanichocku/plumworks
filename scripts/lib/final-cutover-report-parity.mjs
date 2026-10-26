import { mapLegacyInvoiceFinancials, parseLegacyMoneyCents } from "./legacy-invoice-financials.mjs";
import { groupRowsByRo, selectLegacyInvoiceDate } from "./legacy-invoice-reconciliation.mjs";
import { LEGACY_TENDER_BUCKETS } from "./legacy-payment-import.mjs";

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
  "paymentRowCount",
  "paidInvoiceCount",
  "splitTenderInvoiceCount",
  "cashTotalCents",
  "checkTotalCents",
  "cardTotalCents",
  "internalTotalCents",
  "otherTotalCents",
  "paymentTotalCents",
]);

function parsedCutoverDate(cutoverDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate ?? "")) throw new Error("--cutover-date must use YYYY-MM-DD.");
  const end = new Date(`${cutoverDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== cutoverDate) throw new Error("--cutover-date is invalid.");
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { end, endExclusive };
}

export function cutoverReportPeriods(cutoverDate) {
  const { end, endExclusive } = parsedCutoverDate(cutoverDate);
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

export function allCutoverReportPeriods(cutoverDate, sourceInvoices = []) {
  const { end, endExclusive } = parsedCutoverDate(cutoverDate);
  const currentYear = end.getUTCFullYear();
  const [monthPeriod] = cutoverReportPeriods(cutoverDate);
  const years = [...new Set(sourceInvoices
    .map((invoice) => invoice.invoiceDate)
    .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()) && date <= end)
    .map((date) => date.getUTCFullYear()))]
    .sort((left, right) => left - right);
  if (!years.includes(currentYear)) years.push(currentYear);
  const yearlyPeriods = years.map((year) => ({
    key: year === currentYear ? `${year}-YTD` : `${year}-YEAR`,
    label: year === currentYear ? `${year} year-to-date through ${cutoverDate}` : `${year} calendar year`,
    start: new Date(Date.UTC(year, 0, 1)),
    endExclusive: year === currentYear ? endExclusive : new Date(Date.UTC(year + 1, 0, 1)),
  }));
  return [monthPeriod, ...yearlyPeriods];
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
    paymentRowCount: 0,
    paidInvoiceCount: 0,
    splitTenderInvoiceCount: 0,
    cashTotalCents: 0,
    checkTotalCents: 0,
    cardTotalCents: 0,
    internalTotalCents: 0,
    otherTotalCents: 0,
    paymentTotalCents: 0,
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

function addPaymentRows(totals, paymentRows) {
  if (!paymentRows.length) return;
  totals.paymentRowCount += paymentRows.length;
  totals.paidInvoiceCount += 1;
  if (paymentRows.length > 1) totals.splitTenderInvoiceCount += 1;
  for (const row of paymentRows) {
    const field = `${row.method}TotalCents`;
    if (!(field in totals)) throw new Error(`Unsupported normalized payment method: ${row.method}`);
    totals[field] += row.amountCents;
    totals.paymentTotalCents += row.amountCents;
  }
}

function signature(row) {
  const fields = [
    "PARTS", "LABOR", "TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6", "TOTAL", "PAYMENT",
    "DISCOUNT", "DEDUCT", "BALANCE", "DATE_SOLD", "RO_DATE",
    ...LEGACY_TENDER_BUCKETS.map(({ bucket }) => bucket),
  ];
  return JSON.stringify(fields.map((field) => row.rawData?.[field] == null ? null : String(row.rawData[field]).trim()));
}

function sourcePaymentRows(rawData, legacyRoNo, fatalIssues) {
  const paymentCents = parseLegacyMoneyCents(rawData?.PAYMENT);
  if (paymentCents === null || paymentCents < 0) {
    fatalIssues.push({ code: "invalid-authoritative-payment", legacyRoNo });
    return [];
  }
  const rows = [];
  let invalid = false;
  for (const { bucket, method } of LEGACY_TENDER_BUCKETS) {
    const value = rawData?.[bucket];
    const cents = value === null || value === undefined ? 0 : parseLegacyMoneyCents(value);
    if (cents === null || cents < 0) {
      fatalIssues.push({ code: "invalid-tender-bucket", legacyRoNo, bucket });
      invalid = true;
    } else if (cents > 0) rows.push({ bucket, method, amountCents: cents });
  }
  if (invalid) return [];
  const tenderTotal = rows.reduce((sum, row) => sum + row.amountCents, 0);
  if (tenderTotal !== paymentCents) {
    fatalIssues.push({ code: "source-tender-payment-mismatch", legacyRoNo, paymentCents, tenderTotal });
    return [];
  }
  return rows;
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
    const rawData = groupedAr[0].rawData;
    const financials = mapLegacyInvoiceFinancials(rawData);
    const selectedDate = selectLegacyInvoiceDate({
      arRows: groupedAr,
      finalRows: finalGroups.get(legacyRoNo) ?? [],
      laborRows: laborGroups.get(legacyRoNo) ?? [],
    });
    const paymentRows = sourcePaymentRows(rawData, legacyRoNo, fatalIssues);
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
    invoices.push({ legacyRoNo, invoiceDate: selectedDate.date, financials, paymentRows });
  }
  return { invoices, fatalIssues };
}

export function summarizeSourcePeriod(sourceInvoices, period) {
  const totals = emptyReportTotals();
  for (const invoice of sourceInvoices) {
    if (invoice.invoiceDate < period.start || invoice.invoiceDate >= period.endExclusive) continue;
    addFinancials(totals, invoice.financials);
    addPaymentRows(totals, invoice.paymentRows ?? []);
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

function normalizePaymentMethod(method) {
  const normalized = method?.trim().toLowerCase();
  if (normalized === "debit_card") return "card";
  return ["cash", "check", "card", "internal"].includes(normalized) ? normalized : "other";
}

export function addDestinationPayments(totals, payments) {
  const byInvoice = new Map();
  for (const payment of payments) {
    const method = normalizePaymentMethod(payment.method);
    const amountCents = decimalCents(payment.amount);
    const invoiceId = payment.invoiceId ?? null;
    totals.paymentRowCount += 1;
    totals[`${method}TotalCents`] += amountCents;
    totals.paymentTotalCents += amountCents;
    if (invoiceId) byInvoice.set(invoiceId, (byInvoice.get(invoiceId) ?? 0) + 1);
  }
  totals.paidInvoiceCount = byInvoice.size;
  totals.splitTenderInvoiceCount = [...byInvoice.values()].filter((count) => count > 1).length;
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
