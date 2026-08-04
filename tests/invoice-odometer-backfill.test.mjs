import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  executeInvoiceOdometerBackfill,
  normalizeLegacyOdometer,
  parseInvoiceOdometerBackfillArguments,
  projectInvoiceOdometerBackfill,
} from "../scripts/lib/legacy-odometer.mjs";

test("legacy mileage normalization accepts deterministic numeric forms only", () => {
  assert.equal(normalizeLegacyOdometer("128450"), 128450);
  assert.equal(normalizeLegacyOdometer("128,450"), 128450);
  assert.equal(normalizeLegacyOdometer("128K"), 128000);
  for (const value of [null, "", "0", 0, "-12", "INOP", "12O00", "10000001"]) {
    assert.equal(normalizeLegacyOdometer(value), null);
  }
});

test("backfill uses exact shop and legacy RO identity and is idempotent", () => {
  const plan = projectInvoiceOdometerBackfill({
    shopId: "shop-a",
    rawRows: [
      { shopId: "shop-a", legacyRoNo: "100", rawData: { ODOMETER: "128450" } },
      { shopId: "shop-a", legacyRoNo: "101", rawData: { ODOMETER: "99K" } },
      { shopId: "shop-b", legacyRoNo: "100", rawData: { ODOMETER: "1" } },
    ],
    invoices: [
      { id: "invoice-100", shopId: "shop-a", legacyRoNo: "100", odometer: null },
      { id: "invoice-101", shopId: "shop-a", legacyRoNo: "101", odometer: 99000 },
    ],
  });
  assert.deepEqual(plan.updates, [{ id: "invoice-100", shopId: "shop-a", legacyRoNo: "100", odometer: 128450 }]);
  assert.equal(plan.destinationRecordsMatched, 2);
  assert.equal(plan.alreadyCorrect, 1);
  assert.equal(plan.proposedUpdates, 1);
});

test("dry-run performs zero writes and ambiguous matches fail safely", async () => {
  let writes = 0;
  const ambiguous = projectInvoiceOdometerBackfill({
    shopId: "shop-a",
    rawRows: [
      { shopId: "shop-a", legacyRoNo: "100", rawData: { ODOMETER: "100000" } },
      { shopId: "shop-a", legacyRoNo: "100", rawData: { ODOMETER: "101000" } },
    ],
    invoices: [{ id: "invoice-100", shopId: "shop-a", legacyRoNo: "100", odometer: null }],
  });
  assert.equal(ambiguous.ambiguous, 1);
  assert.deepEqual(await executeInvoiceOdometerBackfill({ confirmed: false, plan: ambiguous, update: async () => { writes += 1; return 1; } }), { databaseWrites: 0 });
  assert.equal(writes, 0);
  await assert.rejects(executeInvoiceOdometerBackfill({ confirmed: true, plan: ambiguous, update: async () => 1 }), /Ambiguous/);
});

test("backfill is dry-run by default and requires an explicit confirmation token", () => {
  const base = ["--shop-id", "shop-a", "--import-run-id", "run-a"];
  assert.equal(parseInvoiceOdometerBackfillArguments(base).dryRun, true);
  assert.equal(parseInvoiceOdometerBackfillArguments([...base, "--confirm", "BACKFILL_INVOICE_ODOMETER"]).confirmed, true);
  assert.throws(() => parseInvoiceOdometerBackfillArguments([...base, "--confirm", "wrong"]), /must equal/);
});

test("Invoice odometer migration is nullable, additive, and non-destructive", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260804150000_add_invoice_odometer/migration.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /model Invoice \{[\s\S]*odometer\s+Int\?/);
  assert.equal(migration.trim(), 'ALTER TABLE "invoices" ADD COLUMN "odometer" INTEGER;');
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|NOT NULL/i);
});

test("future legacy Invoice and open-order transforms preserve normalized source odometer", async () => {
  const [invoiceTransform, openOrderTransform] = await Promise.all([
    readFile(new URL("../scripts/transform-invoices.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/transform-open-orders.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(invoiceTransform, /odometer: link\.odometer/);
  assert.match(invoiceTransform, /normalizeLegacyOdometer\(row\.rawData\?\.ODOMETER\)/);
  assert.match(invoiceTransform, /conflicting AR odometer values/);
  assert.match(openOrderTransform, /odometer = normalizeLegacyOdometer\(header\.rawData\?\.ODOMETER\)/);
});
