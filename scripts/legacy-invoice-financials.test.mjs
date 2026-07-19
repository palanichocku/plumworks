import assert from "node:assert/strict";
import test from "node:test";
import {
  inferHistoricalShopSuppliesSnapshot,
  legacyChargeSynchronization,
  mapLegacyInvoiceFinancials,
} from "./lib/legacy-invoice-financials.mjs";
import { reconcileInvoiceTotal } from "./lib/financial-contract.mjs";

const base = {
  PARTS: "100.00", LABOR: "50.00", TAX: "9.00", TAX2: "4.00",
  TAX3: "0.00", TAX4: "0.00", TAX5: "0.00", TAX6: "0.00",
  DISCOUNT: "0.00", DEDUCT: "0.00", TOTAL: "163.00", PAYMENT: "163.00",
  BALANCE: "0.00",
};

test("maps TAX to taxTotal and stored TAX2 to shop supplies", () => {
  const result = mapLegacyInvoiceFinancials(base);
  assert.equal(result.salesTaxCents, 900);
  assert.equal(result.shopSuppliesCents, 400);
  assert.equal(result.totalCents, 16_300);
});

test("preserves TAX3 separately and never includes it in ordinary sales tax", () => {
  const result = mapLegacyInvoiceFinancials({ ...base, TAX3: "1.25", TOTAL: "164.25" });
  assert.equal(result.salesTaxCents, 900);
  assert.deepEqual(result.legacyAdditionalCharges, [{
    sourceBucket: "TAX3", amountCents: 125, sourceLabel: null,
    taxable: null, legacySourceTable: "ar.DBF",
  }]);
});

test("synchronization inserts, updates, and removes stale zero buckets idempotently", () => {
  assert.deepEqual(
    legacyChargeSynchronization(
      [{ sourceBucket: "TAX3", amountCents: 100 }, { sourceBucket: "TAX4", amountCents: 50 }],
      [{ sourceBucket: "TAX3", amountCents: 125 }],
    ),
    { inserts: [], updates: ["TAX3"], deletes: ["TAX4"] },
  );
  assert.deepEqual(
    legacyChargeSynchronization(
      [{ sourceBucket: "TAX3", amountCents: 125 }],
      [{ sourceBucket: "TAX3", amountCents: 125 }],
    ),
    { inserts: [], updates: ["TAX3"], deletes: [] },
  );
});

test("detects reconciliation mismatch without rewriting AR.TOTAL", () => {
  const result = mapLegacyInvoiceFinancials({ ...base, TOTAL: "163.01" });
  assert.equal(result.totalCents, 16_301);
  assert.equal(result.reconciliation.reconciles, false);
  assert.equal(result.reconciliation.varianceCents, 1);
});

test("rejects missing or malformed authoritative financial fields", () => {
  const result = mapLegacyInvoiceFinancials({ ...base, TAX2: "bad" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingOrMalformedFields, ["TAX2"]);
});

test("treats a present blank fixed-width DBF numeric field as zero", () => {
  const result = mapLegacyInvoiceFinancials({ ...base, TAX3: "" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.legacyAdditionalCharges, []);
});

test("rounds higher-precision legacy line money deterministically to cents", () => {
  const result = mapLegacyInvoiceFinancials({ ...base, TAX2: "4.0050", TOTAL: "163.01" });
  assert.equal(result.shopSuppliesCents, 401);
  assert.equal(result.reconciliation.reconciles, true);
});

test("infers the confirmed 8%/$20 H1 2026 snapshot including zero TAX2", () => {
  const result = inferHistoricalShopSuppliesSnapshot({
    invoiceDate: new Date("2026-01-02T00:00:00Z"),
    storedShopSuppliesCents: 0,
    laborRows: [],
  });
  assert.deepEqual(result, {
    enabled: true, rateBasisPoints: 800, capCents: 2_000, taxable: true,
    eligibleLaborCents: null, calculatedAmountCents: null,
  });
});

test("infers an older 5%/$15 snapshot only from direct capped line evidence", () => {
  const result = inferHistoricalShopSuppliesSnapshot({
    invoiceDate: new Date("2011-01-02T00:00:00Z"),
    storedShopSuppliesCents: 1_500,
    laborRows: [{ rawData: { TAXABLE2: true, LABOR: "400.00", TAX2: "20.00" } }],
  });
  assert.equal(result.rateBasisPoints, 500);
  assert.equal(result.capCents, 1_500);
  assert.equal(result.calculatedAmountCents, 1_500);
});

test("leaves an uncertain historical policy snapshot null", () => {
  const result = inferHistoricalShopSuppliesSnapshot({
    invoiceDate: new Date("2015-01-02T00:00:00Z"),
    storedShopSuppliesCents: 800,
    laborRows: [],
  });
  assert.deepEqual(result, {
    enabled: null, rateBasisPoints: null, capCents: null, taxable: null,
    eligibleLaborCents: null, calculatedAmountCents: null,
  });
});

test("locks the January-June 2026 authoritative aggregate", () => {
  const invoiceCount = 195;
  const result = reconcileInvoiceTotal({
    partsCents: 6_194_711,
    laborCents: 6_178_100,
    shopSuppliesCents: 207_843,
    legacyAdditionalChargesCents: 0,
    salesTaxCents: 479_261,
    discountsCents: 0,
    storedInvoiceTotalCents: 13_059_915,
  });
  assert.equal(invoiceCount, 195);
  assert.equal(result.reconciles, true);
  assert.equal(result.authoritativeTotalCents, 13_059_915);
});
