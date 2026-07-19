import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOrdinarySalesTax,
  calculateShopSuppliesFromSnapshot,
  mapLegacyFinancialBuckets,
  reconcileInvoiceTotal,
} from "./lib/financial-contract.mjs";

const supplies = (eligibleLaborCents, rateBasisPoints, capCents, enabled = true) =>
  calculateShopSuppliesFromSnapshot({
    enabled,
    eligibleLaborCents,
    rateBasisPoints,
    capCents,
  });

test("maps legacy TAX and TAX2 to separate financial buckets", () => {
  const mapped = mapLegacyFinancialBuckets({
    partsCents: 10_000,
    laborCents: 5_000,
    taxCents: 900,
    tax2Cents: 400,
    storedInvoiceTotalCents: 16_300,
  });
  assert.equal(mapped.salesTaxCents, 900);
  assert.equal(mapped.shopSuppliesCents, 400);
  assert.deepEqual(mapped.legacyAdditionalCharges, []);
  assert.equal(mapped.reconciliation.reconciles, true);
});

test("preserves hypothetical TAX3 separately instead of combining it into sales tax", () => {
  const mapped = mapLegacyFinancialBuckets({
    partsCents: 10_000,
    laborCents: 5_000,
    taxCents: 900,
    tax2Cents: 400,
    tax3Cents: 125,
    storedInvoiceTotalCents: 16_425,
  });
  assert.equal(mapped.salesTaxCents, 900);
  assert.equal(mapped.legacyAdditionalChargesCents, 125);
  assert.deepEqual(mapped.legacyAdditionalCharges, [
    { sourceBucket: "TAX3", amountCents: 125 },
  ]);
});

test("keeps the stored legacy invoice total authoritative and reports a mismatch", () => {
  const mapped = mapLegacyFinancialBuckets({
    partsCents: 10_000,
    laborCents: 5_000,
    taxCents: 900,
    tax2Cents: 400,
    storedInvoiceTotalCents: 16_301,
  });
  assert.equal(mapped.invoiceTotalCents, 16_301);
  assert.equal(mapped.reconciliation.calculatedTotalCents, 16_300);
  assert.equal(mapped.reconciliation.varianceCents, 1);
  assert.equal(mapped.reconciliation.reconciles, false);
});

test("calculates historical 8% supplies below the cap", () => {
  assert.equal(supplies(2_200, 800, 2_000), 176);
});

test("caps historical 8% supplies at $20", () => {
  assert.equal(supplies(28_200, 800, 2_000), 2_000);
});

test("caps new-order 8% supplies at $40", () => {
  assert.equal(supplies(60_000, 800, 4_000), 4_000);
});

test("supports the older 5% and $15 policy", () => {
  assert.equal(supplies(40_000, 500, 1_500), 1_500);
});

test("returns zero when shop supplies are disabled", () => {
  assert.equal(supplies(60_000, 800, 4_000, false), 0);
});

test("calculates supplies from eligible labor rather than total labor", () => {
  const totalLaborCents = 52_300;
  const eligibleLaborCents = 37_800;
  assert.equal(totalLaborCents, 52_300);
  assert.equal(supplies(eligibleLaborCents, 800, 2_000), 2_000);
});

test("uses the repair-order snapshot after current shop settings change", () => {
  const repairOrderSnapshot = {
    enabled: true,
    eligibleLaborCents: 60_000,
    rateBasisPoints: 800,
    capCents: 2_000,
  };
  const currentShopSettings = { ...repairOrderSnapshot, capCents: 4_000 };
  assert.equal(calculateShopSuppliesFromSnapshot(repairOrderSnapshot), 2_000);
  assert.equal(calculateShopSuppliesFromSnapshot(currentShopSettings), 4_000);
});

test("preserves an authoritative stored TAX2 amount that differs from calculation", () => {
  const calculatedShopSuppliesCents = supplies(22_600, 800, 2_000);
  const mapped = mapLegacyFinancialBuckets({
    partsCents: 0,
    laborCents: 22_600,
    taxCents: 0,
    tax2Cents: 2_000,
    storedInvoiceTotalCents: 24_600,
  });
  assert.equal(calculatedShopSuppliesCents, 1_808);
  assert.equal(mapped.shopSuppliesCents, 2_000);
  assert.equal(mapped.invoiceTotalCents, 24_600);
});

test("includes taxable supplies in the ordinary taxable base", () => {
  const result = calculateOrdinarySalesTax({
    partsCents: 0,
    laborCents: 9_000,
    shopSuppliesCents: 720,
    partsTaxable: true,
    laborTaxable: false,
    shopSuppliesTaxable: true,
    salesTaxRateBasisPoints: 600,
  });
  assert.deepEqual(result, { taxableBaseCents: 720, salesTaxCents: 43 });
});

test("reconciles parts, labor, supplies, additional charges, tax, and discounts", () => {
  const result = reconcileInvoiceTotal({
    partsCents: 10_000,
    laborCents: 5_000,
    shopSuppliesCents: 400,
    legacyAdditionalChargesCents: 125,
    salesTaxCents: 900,
    discountsCents: 500,
    storedInvoiceTotalCents: 15_925,
  });
  assert.equal(result.reconciles, true);
  assert.equal(result.varianceCents, 0);
});

test("locks the January 2026 aggregate financial contract", () => {
  const invoiceCount = 25;
  const result = reconcileInvoiceTotal({
    partsCents: 702_891,
    laborCents: 583_900,
    shopSuppliesCents: 26_054,
    legacyAdditionalChargesCents: 0,
    salesTaxCents: 48_016,
    discountsCents: 0,
    storedInvoiceTotalCents: 1_360_861,
  });
  assert.equal(invoiceCount, 25);
  assert.equal(result.calculatedTotalCents, 1_360_861);
  assert.equal(result.reconciles, true);
});
