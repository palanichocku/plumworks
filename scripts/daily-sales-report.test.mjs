import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  aggregatePaymentRows,
  buildSalesSummary,
  inclusiveUtcDateRange,
  normalizePaymentMethod,
  reconciliationDifferences,
} from "../src/lib/daily-sales-aggregation.ts";
import { formatMoney } from "../src/lib/formatters.ts";

const decimal = (value) => new Prisma.Decimal(value);
const money = (value) => value.toFixed(2);

function invoiceAggregate(values = {}) {
  return {
    _count: { _all: values.invoiceCount ?? 0 },
    _sum: {
      partsTotal: values.partsTotal === undefined ? null : decimal(values.partsTotal),
      laborTotal: values.laborTotal === undefined ? null : decimal(values.laborTotal),
      subtotal: values.subtotal === undefined ? null : decimal(values.subtotal),
      shopSuppliesAmount: values.shopSuppliesTotal === undefined ? null : decimal(values.shopSuppliesTotal),
      taxTotal: values.taxTotal === undefined ? null : decimal(values.taxTotal),
      total: values.total === undefined ? null : decimal(values.total),
      paidTotal: values.paidTotal === undefined ? null : decimal(values.paidTotal),
    },
  };
}

test("sales keep shop supplies separate from ordinary tax and use Invoice.total for gross", () => {
  const sales = buildSalesSummary(invoiceAggregate({
    invoiceCount: 1, partsTotal: "10", laborTotal: "20", subtotal: "30",
    shopSuppliesTotal: "2", taxTotal: "3", total: "34", paidTotal: "34",
  }), decimal("1"));
  assert.equal(money(sales.shopSuppliesTotal), "2.00");
  assert.equal(money(sales.ordinarySalesTaxTotal), "3.00");
  assert.equal(money(sales.grossSalesTotal), "34.00");
  assert.equal(money(sales.discountsTotal), "2.00");
});

test("money formatting preserves decimal cents without binary floating point", () => {
  assert.equal(formatMoney(decimal("13608.61")), "$13,608.61");
  assert.equal(formatMoney(decimal("-1.005")), "-$1.01");
});

test("payment methods normalize case and whitespace; null, blank, and unknown map to other", () => {
  assert.equal(normalizePaymentMethod(" CASH "), "cash");
  assert.equal(normalizePaymentMethod("Check"), "check");
  assert.equal(normalizePaymentMethod("CARD"), "card");
  assert.equal(normalizePaymentMethod(" Internal "), "internal");
  assert.equal(normalizePaymentMethod(null), "other");
  assert.equal(normalizePaymentMethod("  "), "other");
  assert.equal(normalizePaymentMethod("wire"), "other");
});

test("Payment.amount drives method totals, distinct invoices, and split tenders", () => {
  const result = aggregatePaymentRows([
    { amount: decimal("4.25"), method: "cash", invoiceId: "a" },
    { amount: decimal("5.75"), method: "CARD", invoiceId: "a" },
    { amount: decimal("2.00"), method: null, invoiceId: "b" },
    { amount: decimal("1.00"), method: "unknown", invoiceId: null },
  ]);
  assert.equal(money(result.cashTotal), "4.25");
  assert.equal(money(result.cardTotal), "5.75");
  assert.equal(money(result.otherTotal), "3.00");
  assert.equal(money(result.paymentTotal), "13.00");
  assert.equal(result.paymentRowCount, 4);
  assert.equal(result.paidInvoiceCount, 2);
  assert.equal(result.splitTenderInvoiceCount, 1);
});

test("inclusive end date becomes the exclusive next UTC day", () => {
  const range = inclusiveUtcDateRange("2026-01-01", "2026-01-31");
  assert.equal(range.start.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(range.endExclusive.toISOString(), "2026-02-01T00:00:00.000Z");
});

test("empty ranges return Decimal zero totals", () => {
  const sales = buildSalesSummary(invoiceAggregate(), null);
  const payments = aggregatePaymentRows([]);
  assert.equal(sales.invoiceCount, 0);
  assert.equal(money(sales.grossSalesTotal), "0.00");
  assert.equal(money(sales.discountsTotal), "0.00");
  assert.equal(money(payments.paymentTotal), "0.00");
  assert.equal(payments.paymentRowCount, 0);
});

test("nonzero reconciliation differences remain visible", () => {
  const sales = buildSalesSummary(invoiceAggregate({ subtotal: "12", total: "12", paidTotal: "10" }), null);
  const payments = aggregatePaymentRows([{ amount: decimal("8"), method: "cash", invoiceId: "a" }]);
  const differences = reconciliationDifferences(sales, payments);
  assert.equal(money(differences.salesPaymentDifference), "4.00");
  assert.equal(money(differences.invoicePaidPaymentDifference), "2.00");
});

test("January 2026 sales and payments match the operational contract", () => {
  const sales = buildSalesSummary(invoiceAggregate({
    invoiceCount: 25, partsTotal: "7028.91", laborTotal: "5839.00", subtotal: "12867.91",
    shopSuppliesTotal: "260.54", taxTotal: "480.16", total: "13608.61", paidTotal: "13608.61",
  }), decimal(0));
  const rows = [
    { amount: decimal("115"), method: "cash", invoiceId: "ro21503" },
    { amount: decimal("1.71"), method: "internal", invoiceId: "ro21503" },
    { amount: decimal("45"), method: "cash", invoiceId: "invoice-2" },
    { amount: decimal("13424.90"), method: "card", invoiceId: "invoice-3" },
    ...Array.from({ length: 22 }, (_, index) => ({ amount: decimal("1"), method: "card", invoiceId: `invoice-${index + 4}` })),
  ];
  const payments = aggregatePaymentRows(rows);
  assert.deepEqual({
    count: sales.invoiceCount, gross: money(sales.grossSalesTotal), parts: money(sales.partsTotal),
    labor: money(sales.laborTotal), subtotal: money(sales.subtotal), supplies: money(sales.shopSuppliesTotal),
    tax: money(sales.ordinarySalesTaxTotal), discounts: money(sales.discountsTotal), paid: money(sales.invoicePaidTotal),
  }, { count: 25, gross: "13608.61", parts: "7028.91", labor: "5839.00", subtotal: "12867.91", supplies: "260.54", tax: "480.16", discounts: "0.00", paid: "13608.61" });
  assert.deepEqual({
    cash: money(payments.cashTotal), check: money(payments.checkTotal), card: money(payments.cardTotal),
    internal: money(payments.internalTotal), other: money(payments.otherTotal), total: money(payments.paymentTotal),
    rows: payments.paymentRowCount, invoices: payments.paidInvoiceCount, splits: payments.splitTenderInvoiceCount,
  }, { cash: "160.00", check: "0.00", card: "13446.90", internal: "1.71", other: "0.00", total: "13608.61", rows: 26, invoices: 25, splits: 1 });
  const differences = reconciliationDifferences(sales, payments);
  assert.equal(money(differences.salesPaymentDifference), "0.00");
  assert.equal(money(differences.invoicePaidPaymentDifference), "0.00");
});

test("2025 and January-June 2026 payment contracts remain locked", () => {
  for (const expected of [
    ["8322.45", "16919.41", "247892.36", "158.39", "273292.61"],
    ["832.03", "6803.86", "122959.17", "4.09", "130599.15"],
  ]) {
    const payments = aggregatePaymentRows([
      { amount: decimal(expected[0]), method: "cash", invoiceId: "a" },
      { amount: decimal(expected[1]), method: "check", invoiceId: "b" },
      { amount: decimal(expected[2]), method: "card", invoiceId: "c" },
      { amount: decimal(expected[3]), method: "internal", invoiceId: "d" },
    ]);
    assert.deepEqual([money(payments.cashTotal), money(payments.checkTotal), money(payments.cardTotal), money(payments.internalTotal), money(payments.paymentTotal)], expected);
  }
});
