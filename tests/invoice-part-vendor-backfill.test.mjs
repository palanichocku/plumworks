import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertVendorBackfillWritable,
  buildInvoicePartVendorBackfillPlan,
  chunkVendorUpdates,
  executeVendorUpdateTransaction,
  parseInvoicePartVendorBackfillArguments,
  projectLegacyFinalPartLines,
} from "../scripts/lib/invoice-part-vendor-backfill.mjs";

const ids = { shop: "shop-id", run: "run-id" };

test("vendor backfill requires exact shop, import run, and confirmation token", () => {
  assert.throws(() => parseInvoicePartVendorBackfillArguments([]), /shop-id/);
  assert.throws(() => parseInvoicePartVendorBackfillArguments(["--shop-id", ids.shop]), /import-run-id/);
  const dryRun = parseInvoicePartVendorBackfillArguments(["--shop-id", ids.shop, "--import-run-id", ids.run]);
  assert.equal(dryRun.confirmedWrite, false);
  const confirmed = parseInvoicePartVendorBackfillArguments([
    "--shop-id", ids.shop, "--import-run-id", ids.run,
    "--confirm", "BACKFILL_INVOICE_PART_VENDOR",
  ]);
  assert.equal(confirmed.confirmedWrite, true);
  assert.throws(() => parseInvoicePartVendorBackfillArguments([
    "--shop-id", ids.shop, "--import-run-id", ids.run, "--confirm", "wrong",
  ]), /BACKFILL_INVOICE_PART_VENDOR/);
});

test("legacy FINAL source projects the established deterministic line key and SOURCE only", () => {
  const rawData = { PARTNO: "A-1", DESC: "Part", SOURCE: "SUP1" };
  const lines = projectLegacyFinalPartLines([{ legacyRoNo: "100", rawData }]);
  assert.equal(lines.length, 1);
  assert.match(lines[0].legacyLineKey, /^FINAL:100:[a-f0-9]{24}:1$/);
  assert.equal(lines[0].vendorNameSnapshot, "SUP1");
});

test("plan updates only blank snapshots and is idempotent", () => {
  const source = [{ legacyLineKey: "key", vendorNameSnapshot: "SUP1" }];
  const first = buildInvoicePartVendorBackfillPlan(source, [{ id: "part", legacyLineKey: "key", vendorNameSnapshot: null }]);
  assert.deepEqual(first.updates, [{ id: "part", vendorNameSnapshot: "SUP1" }]);
  assert.equal(first.proposedUpdates, 1);
  const rerun = buildInvoicePartVendorBackfillPlan(source, [{ id: "part", legacyLineKey: "key", vendorNameSnapshot: "SUP1" }]);
  assert.equal(rerun.proposedUpdates, 0);
  assert.equal(rerun.alreadyCorrect, 1);
});

test("missing, conflicting, unresolved, and duplicate matches fail safely", () => {
  const missing = buildInvoicePartVendorBackfillPlan([{ legacyLineKey: "missing", vendorNameSnapshot: null }], []);
  assert.equal(missing.missingSourceVendor, 1);
  assert.doesNotThrow(() => assertVendorBackfillWritable(missing));

  const conflict = buildInvoicePartVendorBackfillPlan(
    [{ legacyLineKey: "key", vendorNameSnapshot: "SUP1" }],
    [{ id: "part", legacyLineKey: "key", vendorNameSnapshot: "OTHER" }],
  );
  assert.equal(conflict.conflicts, 1);
  assert.throws(() => assertVendorBackfillWritable(conflict), /refused/);

  const unresolved = buildInvoicePartVendorBackfillPlan([{ legacyLineKey: "none", vendorNameSnapshot: "SUP1" }], []);
  assert.throws(() => assertVendorBackfillWritable(unresolved), /refused/);

  const ambiguous = buildInvoicePartVendorBackfillPlan(
    [{ legacyLineKey: "dup", vendorNameSnapshot: "SUP1" }, { legacyLineKey: "dup", vendorNameSnapshot: "SUP1" }],
    [{ id: "part", legacyLineKey: "dup", vendorNameSnapshot: null }],
  );
  assert.equal(ambiguous.ambiguous, 1);
  assert.throws(() => assertVendorBackfillWritable(ambiguous), /refused/);
});

test("write script is shop/run scoped, transactional, and changes only vendorNameSnapshot", () => {
  const script = fs.readFileSync("scripts/backfill-invoice-part-vendors.mjs", "utf8");
  assert.match(script, /legacyImportRun\.findFirst\([\s\S]*id: options\.importRunId, shopId: options\.shopId/);
  assert.match(script, /rawLegacyFinal\.findMany\([\s\S]*shopId: options\.shopId, legacyImportRunId: options\.importRunId/);
  assert.match(script, /invoice\.findMany\([\s\S]*shopId: options\.shopId, legacyRoNo: \{ not: null \}/);
  assert.match(script, /SET vendor_name_snapshot = planned\.vendor_name_snapshot/);
  assert.match(script, /destination\.id = planned\.id/);
  assert.match(script, /destination\.shop_id = \$\{shopId\}::uuid/);
  assert.match(script, /destination\.vendor_name_snapshot IS NULL/);
  assert.doesNotMatch(script, /SET\s+(description|part_number|quantity|unit_price)/);
  assert.match(script, /if \(!options\.confirmedWrite\) \{[\s\S]*report\(plan, 0\)/);
});

test("15,490 updates use bounded 750-row batches", () => {
  const updates = Array.from({ length: 15_490 }, (_, index) => ({ id: String(index), vendorNameSnapshot: "V" }));
  const batches = chunkVendorUpdates(updates);
  assert.equal(batches.length, 21);
  assert.equal(batches[0].length, 750);
  assert.equal(batches.at(-1).length, 490);
});

function transactionalMemory(initialRows) {
  const state = new Map(initialRows.map((row) => [row.id, { ...row }]));
  return {
    state,
    async $transaction(callback) {
      const working = new Map([...state].map(([id, row]) => [id, { ...row }]));
      const result = await callback({ working });
      state.clear();
      for (const [id, row] of working) state.set(id, row);
      return result;
    },
  };
}

async function guardedMemoryBatch(transaction, shopId, batch, failBatch = false) {
  if (failBatch) throw new Error("simulated database failure");
  let affected = 0;
  for (const update of batch) {
    const row = transaction.working.get(update.id);
    if (row?.shopId === shopId && !row.vendorNameSnapshot?.trim()) {
      row.vendorNameSnapshot = update.vendorNameSnapshot;
      affected += 1;
    }
  }
  return affected;
}

test("multiple batches commit through one transaction", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: String(index), shopId: ids.shop, vendorNameSnapshot: null }));
  const database = transactionalMemory(rows);
  const updates = rows.map(({ id }) => ({ id, vendorNameSnapshot: `V${id}` }));
  const affected = await executeVendorUpdateTransaction({
    prisma: database, shopId: ids.shop, updates, batchSize: 2,
    updateBatch: guardedMemoryBatch,
  });
  assert.equal(affected, 5);
  assert.deepEqual([...database.state.values()].map((row) => row.vendorNameSnapshot), ["V0", "V1", "V2", "V3", "V4"]);
});

test("later batch failure rolls back every earlier batch", async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({ id: String(index), shopId: ids.shop, vendorNameSnapshot: null }));
  const database = transactionalMemory(rows);
  let calls = 0;
  await assert.rejects(executeVendorUpdateTransaction({
    prisma: database,
    shopId: ids.shop,
    updates: rows.map(({ id }) => ({ id, vendorNameSnapshot: "V" })),
    batchSize: 2,
    updateBatch: (transaction, shopId, batch) => guardedMemoryBatch(transaction, shopId, batch, ++calls === 2),
  }), /transaction was rolled back/);
  assert.deepEqual([...database.state.values()].map((row) => row.vendorNameSnapshot), [null, null, null]);
});

test("concurrent nonblank change causes count mismatch and full rollback", async () => {
  const rows = [
    { id: "1", shopId: ids.shop, vendorNameSnapshot: null },
    { id: "2", shopId: ids.shop, vendorNameSnapshot: "CONCURRENT" },
  ];
  const database = transactionalMemory(rows);
  await assert.rejects(executeVendorUpdateTransaction({
    prisma: database,
    shopId: ids.shop,
    updates: rows.map(({ id }) => ({ id, vendorNameSnapshot: "PLANNED" })),
    batchSize: 1,
    updateBatch: guardedMemoryBatch,
  }), /transaction was rolled back/);
  assert.equal(database.state.get("1").vendorNameSnapshot, null);
  assert.equal(database.state.get("2").vendorNameSnapshot, "CONCURRENT");
});
