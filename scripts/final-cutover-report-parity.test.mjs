import assert from "node:assert/strict";
import test from "node:test";
import {
  compareReportTotals,
  cutoverReportPeriods,
  summarizeDestinationInvoices,
  summarizeSourcePeriod,
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
  assert.deepEqual(totals, {
    invoiceCount: 1,
    partsTotalCents: 10_000,
    laborTotalCents: 20_000,
    subtotalCents: 30_000,
    shopSuppliesTotalCents: 1_000,
    ordinarySalesTaxTotalCents: 1_800,
    discountsTotalCents: 500,
    legacyChargeTotalCents: 200,
    grossSalesTotalCents: 32_500,
    invoicePaidTotalCents: 32_500,
  });
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
