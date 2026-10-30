import assert from "node:assert/strict";
import test from "node:test";
import {
  addDestinationPayments,
  assertReportSourceMatchesReviewedSnapshot,
  allCutoverReportPeriods,
  compareReportTotals,
  cutoverReportPeriods,
  summarizeDestinationInvoices,
  summarizeSourcePeriod,
  summarizeSourcePeriodWithApprovedExclusions,
} from "./lib/final-cutover-report-parity.mjs";

function financials(overrides = {}) {
  return {
    partsCents: 10_000,
    laborCents: 20_000,
    subtotalCents: 30_000,
    shopSuppliesCents: 1_000,
    salesTaxCents: 1_800,
    discountsCents: 500,
    legacyAdditionalChargesCents: 200,
    totalCents: 32_500,
    paidCents: 32_500,
    ...overrides,
  };
}

test("Oct 31 cutover creates exact October and 2026 YTD periods", () => {
  const periods = cutoverReportPeriods("2026-10-31");
  assert.deepEqual(periods.map((period) => [period.key, period.start.toISOString().slice(0, 10), period.endExclusive.toISOString().slice(0, 10)]), [
    ["2026-10", "2026-10-01", "2026-11-01"],
    ["2026-YTD", "2026-01-01", "2026-11-01"],
  ]);
});

test("final parity includes every historical calendar year plus current YTD", () => {
  const periods = allCutoverReportPeriods("2026-10-31", [
    { invoiceDate: new Date("2024-06-15T00:00:00Z") },
    { invoiceDate: new Date("2025-03-01T00:00:00Z") },
    { invoiceDate: new Date("2026-10-31T00:00:00Z") },
  ]);
  assert.deepEqual(periods.map((period) => [period.key, period.start.toISOString().slice(0, 10), period.endExclusive.toISOString().slice(0, 10)]), [
    ["2026-10", "2026-10-01", "2026-11-01"],
    ["2024-YEAR", "2024-01-01", "2025-01-01"],
    ["2025-YEAR", "2025-01-01", "2026-01-01"],
    ["2026-YTD", "2026-01-01", "2026-11-01"],
  ]);
});

test("month end includes Oct 31 and excludes Nov 1", () => {
  const [october] = cutoverReportPeriods("2026-10-31");
  const totals = summarizeSourcePeriod([
    { legacyRoNo: "1", invoiceDate: new Date("2026-09-30T00:00:00Z"), financials: financials() },
    { legacyRoNo: "2", invoiceDate: new Date("2026-10-01T00:00:00Z"), financials: financials() },
    { legacyRoNo: "3", invoiceDate: new Date("2026-10-31T00:00:00Z"), financials: financials() },
    { legacyRoNo: "4", invoiceDate: new Date("2026-11-01T00:00:00Z"), financials: financials() },
  ], october);
  assert.equal(totals.invoiceCount, 2);
  assert.equal(totals.grossSalesTotalCents, 65_000);
});

test("destination summary mirrors the report financial equation exactly", () => {
  const totals = summarizeDestinationInvoices([{
    partsTotal: "100.00",
    laborTotal: "200.00",
    subtotal: "300.00",
    shopSuppliesAmount: "10.00",
    taxTotal: "18.00",
    total: "325.00",
    paidTotal: "325.00",
    legacyCharges: [{ amount: "2.00" }],
  }]);
  assert.equal(totals.invoiceCount, 1);
  assert.equal(totals.partsTotalCents, 10_000);
  assert.equal(totals.laborTotalCents, 20_000);
  assert.equal(totals.subtotalCents, 30_000);
  assert.equal(totals.shopSuppliesTotalCents, 1_000);
  assert.equal(totals.ordinarySalesTaxTotalCents, 1_800);
  assert.equal(totals.discountsTotalCents, 500);
  assert.equal(totals.legacyChargeTotalCents, 200);
  assert.equal(totals.grossSalesTotalCents, 32_500);
  assert.equal(totals.invoicePaidTotalCents, 32_500);
  assert.equal(totals.paymentTotalCents, 0);
});

test("destination payment summary normalizes report tender methods and split tenders", () => {
  const totals = addDestinationPayments(summarizeDestinationInvoices([]), [
    { invoiceId: "invoice-1", method: "cash", amount: "100.00" },
    { invoiceId: "invoice-1", method: "card", amount: "50.00" },
    { invoiceId: "invoice-2", method: "debit_card", amount: "25.00" },
    { invoiceId: "invoice-3", method: "internal", amount: "10.00" },
    { invoiceId: "invoice-4", method: "other", amount: "5.00" },
  ]);
  assert.equal(totals.paymentRowCount, 5);
  assert.equal(totals.paidInvoiceCount, 4);
  assert.equal(totals.splitTenderInvoiceCount, 1);
  assert.equal(totals.cashTotalCents, 10_000);
  assert.equal(totals.cardTotalCents, 7_500);
  assert.equal(totals.internalTotalCents, 1_000);
  assert.equal(totals.otherTotalCents, 500);
  assert.equal(totals.paymentTotalCents, 19_000);
});

test("source payment rows contribute to the same report totals", () => {
  const [october] = cutoverReportPeriods("2026-10-31");
  const totals = summarizeSourcePeriod([{
    legacyRoNo: "10",
    invoiceDate: new Date("2026-10-31T00:00:00Z"),
    financials: financials({ paidCents: 15_000 }),
    paymentRows: [
      { method: "cash", amountCents: 10_000 },
      { method: "card", amountCents: 5_000 },
    ],
  }], october);
  assert.equal(totals.paymentRowCount, 2);
  assert.equal(totals.paidInvoiceCount, 1);
  assert.equal(totals.splitTenderInvoiceCount, 1);
  assert.equal(totals.cashTotalCents, 10_000);
  assert.equal(totals.cardTotalCents, 5_000);
  assert.equal(totals.paymentTotalCents, 15_000);
});

test("parity comparison fails on a one-cent difference", () => {
  const source = summarizeDestinationInvoices([{
    partsTotal: "100.00", laborTotal: "200.00", subtotal: "300.00", shopSuppliesAmount: "10.00",
    taxTotal: "18.00", total: "325.00", paidTotal: "325.00", legacyCharges: [{ amount: "2.00" }],
  }]);
  const destination = { ...source, grossSalesTotalCents: source.grossSalesTotalCents + 1 };
  assert.deepEqual(compareReportTotals(source, destination), [
    { field: "grossSalesTotalCents", source: 32_500, destination: 32_501, difference: 1 },
  ]);
});

const zeroDollarInvoice = {
  legacyRoNo: "18181",
  invoiceDate: new Date("2020-09-25T00:00:00Z"),
  financials: financials({ partsCents: 0, laborCents: 0, subtotalCents: 0, shopSuppliesCents: 0, salesTaxCents: 0, discountsCents: 0, legacyAdditionalChargesCents: 0, totalCents: 0, paidCents: 0 }),
  paymentRows: [],
};
const year2020 = { start: new Date("2020-01-01T00:00:00Z"), endExclusive: new Date("2021-01-01T00:00:00Z") };
const reviewedZeroDollarExclusion = { legacyOrderNumber: "18181", total: "0.00", disposition: "keep-skipped", reviewStatus: "approved-skip" };

test("reviewed zero-dollar excluded invoice passes with a named approved exception", () => {
  const source = summarizeSourcePeriodWithApprovedExclusions([zeroDollarInvoice], year2020, [reviewedZeroDollarExclusion]);
  const destination = summarizeDestinationInvoices([]);
  assert.deepEqual({ raw: source.rawSourceInvoiceCount, imported: destination.invoiceCount, excluded: source.approvedExcludedInvoiceCount, ros: source.approvedExcludedRoNumbers, adjusted: source.adjustedExpectedInvoiceCount }, {
    raw: 1, imported: 0, excluded: 1, ros: ["18181"], adjusted: 0,
  });
  assert.deepEqual(compareReportTotals(source.totals, destination), []);
  assert.equal(source.adjustedExpectedInvoiceCount, destination.invoiceCount);
});

test("an absent reviewed approval leaves the missing source invoice as a hard failure", () => {
  const source = summarizeSourcePeriodWithApprovedExclusions([zeroDollarInvoice], year2020);
  const destination = summarizeDestinationInvoices([]);
  assert.deepEqual(compareReportTotals(source.totals, destination), [
    { field: "invoiceCount", source: 1, destination: 0, difference: -1 },
  ]);
});

test("approved exclusion cannot hide a nonzero invoice or payment", () => {
  const nonzero = { ...zeroDollarInvoice, financials: financials({ totalCents: 1, paidCents: 1 }), paymentRows: [{ amountCents: 1 }] };
  assert.throws(() => summarizeSourcePeriodWithApprovedExclusions([nonzero], year2020, [reviewedZeroDollarExclusion]), /zero-dollar, unpaid source invoice/);
});

test("a one-cent financial difference still fails with an approved count exception", () => {
  const source = summarizeSourcePeriodWithApprovedExclusions([zeroDollarInvoice], year2020, [reviewedZeroDollarExclusion]);
  const destination = { ...summarizeDestinationInvoices([]), laborTotalCents: 1 };
  assert.deepEqual(compareReportTotals(source.totals, destination), [
    { field: "laborTotalCents", source: 0, destination: 1, difference: 1 },
  ]);
});

test("reviewed snapshot binds every report DBF by its own source hash", () => {
  const snapshot = { sourceHashes: { "ar.DBF": "a".repeat(64), "FINAL.DBF": "b".repeat(64), "laborfinal.DBF": "c".repeat(64) } };
  assert.doesNotThrow(() => assertReportSourceMatchesReviewedSnapshot(snapshot.sourceHashes, snapshot));
  assert.throws(() => assertReportSourceMatchesReviewedSnapshot({ ...snapshot.sourceHashes, "ar.DBF": "d".repeat(64) }, snapshot), /ar\.DBF does not match/);
});
