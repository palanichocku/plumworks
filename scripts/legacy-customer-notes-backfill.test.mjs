import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalCustomerNonNotesHash,
  executeLegacyCustomerNotesBackfill,
  parseLegacyCustomerNotesBackfillArguments,
  planLegacyCustomerNotesBackfill,
  readLegacyCustomerNoteSources,
} from "./lib/legacy-customer-notes-backfill.mjs";

const requiredArgs = [
  "--shop-id", "00000000-0000-4000-8000-000000000001",
  "--source-root", "/accepted/snapshot",
  "--snapshot-manifest", "/accepted/snapshot/manifest.json",
  "--database-fingerprint", "a".repeat(64),
];

function customer(id, legacyCustno, notes = null) {
  return {
    id, shopId: "shop", displayName: `Customer ${id}`, email: null, phone: null, phone2: null,
    addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
    notes, message: null, legacyCustno, legacySourceTable: "Cust.DBF",
    archivedAt: null, createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z"),
  };
}

test("arguments default to dry run and confirmed writes require protected evidence", () => {
  assert.equal(parseLegacyCustomerNotesBackfillArguments(requiredArgs).dryRun, true);
  assert.throws(() => parseLegacyCustomerNotesBackfillArguments([...requiredArgs, "--confirm", "BACKFILL_LEGACY_CUSTOMER_NOTES"]), /evidence-output/);
  assert.equal(parseLegacyCustomerNotesBackfillArguments([...requiredArgs, "--evidence-output", "/private/evidence.json", "--confirm", "BACKFILL_LEGACY_CUSTOMER_NOTES"]).dryRun, false);
});

test("notes planner fills null targets, preserves multiline text, and is idempotent", () => {
  const notes = "First line\r\nSecond line";
  const sources = [{ legacyCustno: "one", notes }, { legacyCustno: "two", notes: null }];
  const first = planLegacyCustomerNotesBackfill({ sources, customers: [customer("1", "one"), customer("2", "two")] });
  assert.deepEqual(first.proposals, [{ id: "1", legacyCustno: "one", beforeNotes: null, notes }]);
  assert.deepEqual(first.counts, { inspected: 2, proposedFills: 1, multilineProposed: 1, alreadyCurrent: 0, targetConflicts: 0, sourceAmbiguities: 0, noSourceNote: 1, aliasProtected: 0 });
  const second = planLegacyCustomerNotesBackfill({ sources, customers: [customer("1", "one", notes), customer("2", "two")] });
  assert.equal(second.counts.proposedFills, 0);
  assert.equal(second.counts.alreadyCurrent, 1);
});

test("nonblank conflicts, ambiguous sources, and aliases fail closed", () => {
  const sources = [
    { legacyCustno: "conflict", notes: "Legacy" },
    { legacyCustno: "ambiguous", notes: "A" }, { legacyCustno: "ambiguous", notes: "B" },
    { legacyCustno: "old-alias", notes: "Obsolete identity note" },
  ];
  const plan = planLegacyCustomerNotesBackfill({
    sources,
    customers: [customer("1", "conflict", "Current"), customer("2", "ambiguous")],
    aliases: [{ aliasLegacyCustno: "old-alias", customerId: "1" }],
  });
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.counts.targetConflicts, 1);
  assert.equal(plan.counts.sourceAmbiguities, 1);
  assert.equal(plan.counts.aliasProtected, 1);
});

test("memo-aware Cust.DBF reader preserves CRLF text", () => {
  const fields = [{ name: "CUSTNO", type: "C", length: 10 }, { name: "NOTE", type: "M", length: 4 }];
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const dbf = Buffer.alloc(headerLength + recordLength);
  dbf.writeUInt32LE(1, 4); dbf.writeUInt16LE(headerLength, 8); dbf.writeUInt16LE(recordLength, 10);
  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    dbf.write(field.name, offset, "ascii"); dbf[offset + 11] = field.type.charCodeAt(0); dbf[offset + 16] = field.length;
  });
  dbf[32 + fields.length * 32] = 0x0d;
  const record = headerLength; dbf[record] = 0x20; dbf.write("SYNTHETIC ", record + 1, "ascii"); dbf.writeUInt32LE(1, record + 11);
  const text = Buffer.from("First line\r\nSecond line", "latin1");
  const memo = Buffer.alloc(64 + 8 + text.length); memo.writeUInt16BE(64, 6); memo.writeUInt32BE(1, 64); memo.writeUInt32BE(text.length, 68); text.copy(memo, 72);
  assert.deepEqual(readLegacyCustomerNoteSources(dbf, memo), [{ legacyCustno: "SYNTHETIC", notes: "First line\r\nSecond line" }]);
});

test("executor updates only notes with exact identity and optimistic old-value predicates", async () => {
  const calls = [];
  const transaction = { $queryRawUnsafe: async (...args) => { calls.push(args); return [{ id: "1" }]; } };
  await executeLegacyCustomerNotesBackfill({ transaction, shopId: "shop", proposals: [{ id: "1", legacyCustno: "one", beforeNotes: null, notes: "Text" }] });
  const [sql, ...values] = calls[0];
  assert.match(sql, /^UPDATE customers SET notes = /);
  assert.doesNotMatch(sql, /phone|email|address|display_name|updated_at|vehicle|invoice|repair_order/i);
  assert.match(sql, /legacy_source_table = 'Cust\.DBF'/);
  assert.match(sql, /notes IS NOT DISTINCT FROM/);
  assert.deepEqual(values, ["Text", "1", "shop", "one", null]);
});

test("non-notes control hash ignores notes but detects unrelated Customer changes", () => {
  const original = customer("1", "one");
  assert.equal(canonicalCustomerNonNotesHash([original]), canonicalCustomerNonNotesHash([{ ...original, notes: "Allowed" }]));
  assert.notEqual(canonicalCustomerNonNotesHash([original]), canonicalCustomerNonNotesHash([{ ...original, phone: "changed" }]));
});
