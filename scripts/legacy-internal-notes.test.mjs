import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerData, legacyNote, preservedOperationalNote, vehicleData } from "./lib/customer-vehicle-transform.mjs";
import { customerCreateData } from "./lib/legacy-customer-recovery.mjs";
import { affectedNotesIntegrity, assertCleanupCounts, assertCleanupIntegrity, classifyLegacyNotes, parseLegacyNotesCleanupArguments, runLegacyNotesCleanup } from "./lib/legacy-notes-cleanup.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("legacy note normalization accepts only trimmed strings and preserves internal line breaks", () => {
  assert.equal(legacyNote("  First\n  Second  "), "First\n  Second");
  assert.equal(legacyNote(" \n "), null);
  assert.equal(legacyNote({ memoPointer: "12" }), null);
  assert.equal(legacyNote({ value: "note" }), null);
  assert.equal(legacyNote(["note"]), null);
  assert.equal(legacyNote("[object Object]"), null);
  assert.equal(legacyNote("[object Array]"), null);
});

test("Customer NOTE and Vehicle NOTE/HISTNOTES mappings use only valid decoded strings", () => {
  const customer = customerData({ legacyCustno: "1", rawData: { CUSTOMER: "Example", NOTE: "line one\nline two" } });
  assert.equal(customer.notes, "line one\nline two");
  const primary = vehicleData({ legacyCustno: "1", legacyCarno: "2", rawData: { NOTE: "Primary", HISTNOTES: "History" } });
  assert.equal(primary.notes, "Primary");
  const fallback = vehicleData({ legacyCustno: "1", legacyCarno: "2", rawData: { NOTE: " ", HISTNOTES: "History\nLine" } });
  assert.equal(fallback.notes, "History\nLine");
  const pointer = vehicleData({ legacyCustno: "1", legacyCarno: "2", rawData: { NOTE: { memoPointer: "4" }, HISTNOTES: { memoPointer: "5" } } });
  assert.equal(pointer.notes, null);
});

test("reruns preserve nonblank operational notes and populate only blank notes from valid legacy text", () => {
  assert.equal(preservedOperationalNote("PlumWorks note\nkeep", "Legacy note"), "PlumWorks note\nkeep");
  assert.equal(preservedOperationalNote(null, "Legacy note"), "Legacy note");
  assert.equal(preservedOperationalNote("  ", "Legacy note"), "Legacy note");
  assert.equal(preservedOperationalNote("Keep", null), "Keep");
  assert.equal(preservedOperationalNote("Keep", { memoPointer: "2" }), "Keep");
  assert.equal(preservedOperationalNote(null, { memoPointer: "2" }), null);
});

test("transformer selects operational notes and uses preservation for both update paths", async () => {
  const source = await read("scripts/transform-customers-vehicles.mjs");
  assert.equal((source.match(/notes: true/g) ?? []).length, 2);
  assert.equal((source.match(/notes: preservedOperationalNote/g) ?? []).length, 2);
  assert.doesNotMatch(source, /createdAt[^\n]*notes|updatedAt[^\n]*notes/);
});

test("recovery customer creation no longer stores technical metadata in Customer.notes", async () => {
  const entry = { legacyCustomerId: "1", displayName: "Historical", phone: null, alternatePhone: null, address: null, city: null, state: null, postalCode: null, classification: "normal-historical", notes: "source explanation" };
  const created = customerCreateData(entry, "shop");
  assert.equal("notes" in created, false);
  const [manifest, recovery] = await Promise.all([read("../plumworks-deployments/clients/cardoc/imports/legacy-customer-recovery.json"), read("scripts/recover-legacy-customers.mjs")]);
  assert.match(manifest, /"notes"/);
  assert.match(recovery, /source: "legacy-customer-recovery\.json", notes: entry\.notes/);
});

test("cleanup classification clears only exact targets and preserves meaningful notes", () => {
  const customers = [
    { id: "c1", notes: "[legacy recovery: normal] explanation", legacySourceTable: null, legacyCustno: null },
    { id: "c2", notes: " [legacy recovery: normal] leading space", legacySourceTable: "Cust.DBF", legacyCustno: "2" },
    { id: "c3", notes: "Real customer note", legacySourceTable: "Cust.DBF", legacyCustno: "3" },
  ];
  const vehicles = [
    { id: "v1", notes: "  [object Object] \n", legacySourceTable: "vehicles.DBF", legacyCarno: "1" },
    { id: "v2", notes: "Before [object Object] after", legacySourceTable: null, legacyCarno: null },
  ];
  const result = classifyLegacyNotes(customers, vehicles);
  assert.deepEqual(result.affectedCustomers.map(({ id }) => id), ["c1"]);
  assert.deepEqual(result.affectedVehicles.map(({ id }) => id), ["v1"]);
  assert.deepEqual(result.preservedCustomers.map(({ id }) => id), ["c2", "c3"]);
  assert.deepEqual(result.preservedVehicles.map(({ id }) => id), ["v2"]);
  assert.equal(classifyLegacyNotes([{ ...customers[0], notes: null }], [{ ...vehicles[0], notes: null }]).affectedCustomers.length, 0);
});

test("cleanup defaults dry, rejects wrong confirmation, and backup failure prevents its transaction", async () => {
  assert.equal(parseLegacyNotesCleanupArguments([]).dryRun, true);
  assert.throws(() => parseLegacyNotesCleanupArguments(["--confirm", "WRONG"]), /CLEAN_LEGACY_INTERNAL_NOTES/);
  let transactionRan = false;
  await assert.rejects(runLegacyNotesCleanup({ createBackup: async () => { throw new Error("backup failed"); }, transaction: async () => { transactionRan = true; } }), /backup failed/);
  assert.equal(transactionRan, false);
});

test("confirmed cleanup is one transaction with exact guarded updates and secure backup metadata", async () => {
  const source = await read("scripts/cleanup-legacy-internal-notes.mjs");
  assert.equal((source.match(/prisma\.\$transaction/g) ?? []).length, 1);
  assert.match(source, /isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000/);
  assert.doesNotMatch(source, /for \(const row of current\.(?:affectedCustomers|affectedVehicles)\)/);
  assert.equal((source.match(/transaction\.customer\.updateMany/g) ?? []).length, 1);
  assert.equal((source.match(/transaction\.\$executeRaw`UPDATE "vehicles"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /id:\s*\{\s*in:/);
  assert.match(source, /shopId, notes: \{ startsWith: LEGACY_RECOVERY_PREFIX \}/);
  assert.match(source, /"shop_id" = \$\{shopId\}::uuid AND btrim\("notes"\) = \$\{OBJECT_NOTE\}/);
  assert.match(source, /SET "notes" = NULL, "updated_at" = NOW\(\)/);
  assert.match(source, /select: \{ id: true, shopId: true, notes: true \}/);
  assert.match(source, /assertCleanupCounts\(expectedCustomers, customerResult\.count, expectedVehicles, vehiclesUpdated, remainingCustomers, remainingVehicles\)/);
  assert.match(source, /mode: 0o700/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /affectedRecordsSha256/);
  assert.match(source, /credentialsStored: false/);
  assert.match(source, /No database changes performed\./);
  assert.doesNotMatch(source, /console\.log\([^\n]*\.notes/);
});

test("hash and count mismatches throw so the surrounding transaction rolls back", () => {
  const expected = affectedNotesIntegrity([{ id: "c", shopId: "s", notes: "[legacy recovery:x" }], []);
  assert.doesNotThrow(() => assertCleanupIntegrity(expected, expected));
  assert.throws(() => assertCleanupIntegrity(expected, affectedNotesIntegrity([], [])), /changed after backup/);
  assert.doesNotThrow(() => assertCleanupCounts(12, 12, 5192, 5192, 0, 0));
  assert.throws(() => assertCleanupCounts(12, 11, 5192, 5192, 0, 0), /count mismatch/);
  assert.throws(() => assertCleanupCounts(12, 12, 5192, 5192, 0, 1), /remain/);
});
