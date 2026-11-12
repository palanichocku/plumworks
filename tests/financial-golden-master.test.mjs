import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateEditableInvoiceTotals,
  calculateRepairOrderEstimateTotals,
  invoiceBalance,
} from "../src/lib/invoice-lifecycle.ts";
import { isReportableSaleInRange } from "../src/lib/reportable-sales.ts";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/financial-golden-master.json", import.meta.url), "utf8"),
);

function cents(value) {
  const normalized = String(value).trim();
  const negative = normalized.startsWith("-");
  const [wholePart, fractionalPart = ""] = (negative ? normalized.slice(1) : normalized).split(".");
  const whole = Number.parseInt(wholePart || "0", 10);
  const fraction = Number.parseInt(`${fractionalPart}00`.slice(0, 2), 10);
  const amount = whole * 100 + fraction;
  return negative ? -amount : amount;
}

function moneyFromCents(value) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function totalForRange(start, endExclusive) {
  const range = { start: new Date(start), endExclusive: new Date(endExclusive) };
  const total = fixture.sales
    .map((sale) => ({
      ...sale,
      invoiceDate: sale.invoiceDate ? new Date(sale.invoiceDate) : null,
      closedAt: sale.closedAt ? new Date(sale.closedAt) : null,
    }))
    .filter((sale) => isReportableSaleInRange(sale, range))
    .reduce((sum, sale) => sum + cents(sale.total), 0);
  return moneyFromCents(total);
}

test("sanitized reporting fixture preserves reconciled Car Doc control totals", () => {
  assert.equal(totalForRange("2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"), fixture.controls.year2025);
  assert.equal(totalForRange("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"), fixture.controls.jan2026);
  assert.equal(totalForRange("2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"), fixture.controls.q1_2026);
  assert.equal(totalForRange("2026-01-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"), fixture.controls.h1_2026);
});

test("native open invoices remain excluded even when a closedAt-like date exists", () => {
  const may = totalForRange("2026-05-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z");
  assert.equal(may, "30000.00");
});

test("repair-order totals use Decimal math, exclude complimentary labor, and preserve tax behavior", () => {
  const totals = calculateRepairOrderEstimateTotals({
    parts: [{ quantity: "2", unitPrice: "49.95" }],
    labor: [
      { hours: "1.5", hourlyRate: "120.00", complimentary: false, shopSuppliesEligible: true },
      { hours: "0.5", hourlyRate: "80.00", complimentary: true, shopSuppliesEligible: true },
    ],
    shopSuppliesEnabled: true,
    shopSuppliesRate: "0.05",
    shopSuppliesCap: "20.00",
    taxRate: "0.06",
    partsTaxable: true,
    laborTaxable: false,
    shopSuppliesTaxable: true,
  });

  assert.equal(totals.partsTotal.toFixed(2), "99.90");
  assert.equal(totals.laborTotal.toFixed(2), "180.00");
  assert.equal(totals.shopSuppliesEligibleLaborTotal.toFixed(2), "180.00");
  assert.equal(totals.shopSuppliesAmount.toFixed(2), "9.00");
  assert.equal(totals.taxTotal.toFixed(2), "6.53");
  assert.equal(totals.total.toFixed(2), "295.43");
});

test("editable invoice totals reject invalid discounts and preserve two-decimal balance math", () => {
  assert.throws(
    () => calculateEditableInvoiceTotals({
      parts: [{ quantity: "1", unitPrice: "100.00" }],
      labor: [],
      shopSuppliesEnabled: false,
      shopSuppliesRate: "0",
      shopSuppliesCap: "0",
      taxRate: "0.06",
      partsTaxable: true,
      laborTaxable: false,
      shopSuppliesTaxable: false,
      discountAmount: "100.01",
    }),
    /Discount cannot exceed Parts and Labor/,
  );

  assert.equal(invoiceBalance("100.00", "40.01").toFixed(2), "59.99");
});
