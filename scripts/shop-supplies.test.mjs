import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateShopSupplies, calculateShopSuppliesFromPercentage } from "../src/lib/shop-supplies.ts";
import { calculateEditableInvoiceTotals } from "../src/lib/invoice-lifecycle.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const calculate = (laborSubtotal, rate = "0.08", maximumCap = "40", enabled = true) =>
  calculateShopSupplies({ enabled, laborSubtotal, rate, maximumCap });

test("Shop Supplies uses exact Decimal labor-rate-cap semantics", () => {
  assert.equal(calculate("120").appliedAmount.toFixed(2), "9.60");
  assert.equal(calculate("500").appliedAmount.toFixed(2), "40.00");
  assert.equal(calculate("600").appliedAmount.toFixed(2), "40.00");
  assert.equal(calculate("0").appliedAmount.toFixed(2), "0.00");
  assert.equal(calculate("120", "0.08", "40", false).appliedAmount.toFixed(2), "0.00");
  assert.equal(calculateShopSuppliesFromPercentage({ enabled: true, laborSubtotal: "123.45", ratePercent: "7.125", maximumCap: "40" }).appliedAmount.toFixed(2), "8.80");
  assert.equal(calculate("1.05", "0.05", "40").appliedAmount.toFixed(2), "0.05");
});

test("invalid negative and above-100-percent inputs are rejected", () => {
  assert.throws(() => calculate("-1"), /Labor subtotal/);
  assert.throws(() => calculate("1", "-0.01"), /rate/);
  assert.throws(() => calculate("1", "1.01"), /rate/);
  assert.throws(() => calculate("1", "0.08", "-1"), /maximum charge/);
});

test("tax includes supplies, excludes labor, and parts do not drive supplies", () => {
  const example = calculateEditableInvoiceTotals({ parts: [{ quantity: "1", unitPrice: "50" }], labor: [{ hours: "1", hourlyRate: "30" }], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "40", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(example.shopSuppliesAmount.toFixed(2), "2.40");
  assert.equal(example.taxTotal.toFixed(2), "3.14");
  assert.equal(example.total.toFixed(2), "85.54");
  const suppliesNotTaxable = calculateEditableInvoiceTotals({ parts: [{ quantity: "1", unitPrice: "50" }], labor: [{ hours: "1", hourlyRate: "30" }], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "40", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: false });
  assert.equal(suppliesNotTaxable.taxTotal.toFixed(2), "3.00");
  const laborTaxable = calculateEditableInvoiceTotals({ parts: [], labor: [{ hours: "1", hourlyRate: "30" }], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "40", taxRate: "0.06", partsTaxable: true, laborTaxable: true, shopSuppliesTaxable: true });
  assert.equal(laborTaxable.taxTotal.toFixed(2), "1.94");
  const laborOnly = calculateEditableInvoiceTotals({ parts: [], labor: [{ hours: "1.2", hourlyRate: "100" }], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "40", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(laborOnly.shopSuppliesAmount.toFixed(2), "9.60");
  assert.equal(laborOnly.taxTotal.toFixed(2), "0.58");
  const partsOnly = calculateEditableInvoiceTotals({ parts: [{ quantity: "1", unitPrice: "100" }], labor: [], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "40", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(partsOnly.shopSuppliesAmount.toFixed(2), "0.00");
  assert.equal(partsOnly.taxTotal.toFixed(2), "6.00");
});

test("settings and help UI are tenant-authorized, transparent, and accurate", async () => {
  const [action, page, preview, repairHelp, adminHelp] = await Promise.all([read("src/app/(app)/admin/shop-settings/actions.ts"), read("src/app/(app)/admin/shop-settings/page.tsx"), read("src/components/shop-supplies-settings.tsx"), read("src/app/(app)/help/repair-orders/page.tsx"), read("src/app/(app)/help/admin/page.tsx")]);
  assert.match(action, /requirePermission\("edit_shop_settings"\)/);
  assert.match(action, /where: \{ id: membership\.shopId \}/);
  assert.doesNotMatch(action, /formData\.get\("shopId"\)/);
  assert.match(page + preview, /Calculation basis: Labor subtotal/);
  assert.match(preview, /Shop Supplies = the lesser/);
  assert.match(preview, /when marked taxable[\s\S]*included in the taxable amount/);
  assert.match(preview, /taxable Parts \+ taxable Shop Supplies \+ taxable Labor when enabled/);
  assert.match(preview, /name="shopSuppliesTaxable"/);
  assert.match(action, /shopSuppliesTaxable: formData\.get\("shopSuppliesTaxable"\) === "on"/);
  assert.match(preview, /Example labor subtotal/);
  assert.doesNotMatch(preview, /name="(?:example|laborSubtotal)/);
  assert.match(repairHelp, /Shop Supplies are calculated from Labor/);
  assert.match(repairHelp, /Sales tax uses taxable Parts, taxable Shop Supplies, and Labor only when Labor taxability is enabled/);
  assert.match(adminHelp, /taxability for Parts, Labor, and Shop Supplies/);
  assert.doesNotMatch(page + preview + repairHelp, /tax is based only on Parts/i);
});

test("web workflows recalculate from snapshots while legacy and closed invoices stay protected", async () => {
  const [repairTotals, createInvoice, invoiceEdit] = await Promise.all([read("src/lib/repair-order-totals.ts"), read("src/app/(app)/repair-orders/finalize-actions.ts"), read("src/app/(app)/invoices/lifecycle-actions.ts")]);
  assert.match(repairTotals, /calculateWebTransactionTotals/);
  assert.match(repairTotals, /shopSuppliesTaxable: order\.shopSuppliesTaxableSnapshot/);
  assert.match(repairTotals, /shopSuppliesEligibleLaborTotal: totals\.shopSuppliesEligibleLaborTotal/);
  assert.match(createInvoice, /calculateEditableInvoiceTotals/);
  assert.match(invoiceEdit, /shopSuppliesRateSnapshot/);
  assert.match(invoiceEdit, /status: "open", legacySourceTable: null/);
});

test("existing Shop Supplies migration is additive and performs no historical rewrite", async () => {
  const migration = await read("prisma/migrations/20260719120000_add_shop_supplies_financial_fields/migration.sql");
  assert.match(migration, /ADD COLUMN "shop_supplies_enabled"/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|UPDATE)\b/im);
});
