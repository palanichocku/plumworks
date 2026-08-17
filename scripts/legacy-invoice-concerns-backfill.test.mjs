import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalInvoiceControlHash,
  executeLegacyInvoiceConcernsBackfill,
  parseLegacyInvoiceConcernsBackfillArguments,
  planLegacyInvoiceConcernsBackfill,
} from "./lib/legacy-invoice-concerns-backfill.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const required = ["--shop-id", shopId, "--source-root", "/snapshot", "--snapshot-manifest", "/snapshot/manifest.json", "--database-fingerprint", "a".repeat(64)];

function invoice(ro, overrides = {}) {
  return {
    id: `00000000-0000-4000-8000-${ro.padStart(12, "0")}`, legacyRoNo: ro,
    legacySourceTable: "ar.DBF", customerComplaint: null, recommendation: null,
    customerId: "customer", vehicleId: "vehicle", repairOrderId: null,
    invoiceDate: new Date("2026-08-15T00:00:00Z"), closedAt: null, status: "paid", odometer: 12345,
    total: "160.00", paidTotal: "160.00", partsTotal: "100.00", laborTotal: "50.00",
    shopSuppliesAmount: "4.00", taxTotal: "6.00",
    customer: { legacyCustno: "10" }, vehicle: { legacyCarno: "20" },
    ...overrides,
  };
}

function header(ro, complaint = "Concern", recommendation = "Recommendation", overrides = {}) {
  return {
    legacyRoNo: ro, legacyCustno: overrides.legacyCustno ?? "10", legacyCarno: overrides.legacyCarno ?? "20",
    rawData: { DATE_SOLD: overrides.dateSold ?? "20260815", VNOTES: complaint, RECOMEND: recommendation },
  };
}

test("arguments default to dry run and require exact write confirmation and identity inputs", () => {
  assert.equal(parseLegacyInvoiceConcernsBackfillArguments(required).dryRun, true);
  assert.equal(parseLegacyInvoiceConcernsBackfillArguments([...required, "--evidence-output", "/private/evidence.json"]).evidenceOutput, "/private/evidence.json");
  assert.equal(parseLegacyInvoiceConcernsBackfillArguments([...required, "--confirm", "BACKFILL_LEGACY_INVOICE_CONCERNS"]).confirmedWrite, true);
  assert.throws(() => parseLegacyInvoiceConcernsBackfillArguments([...required, "--confirm", "WRONG"]), /must equal/);
  assert.throws(() => parseLegacyInvoiceConcernsBackfillArguments([...required, "--dry-run", "--confirm", "BACKFILL_LEGACY_INVOICE_CONCERNS"]), /cannot be combined/);
});

test("null targets receive complaint, recommendation, both, and exact multiline CRLF", () => {
  const multiline = "LINE ONE\r\nLINE TWO";
  const result = planLegacyInvoiceConcernsBackfill({ invoices: [invoice("100")], headers: [header("100", " Concern ", ` ${multiline} `)] });
  assert.equal(result.counts.complaintUpdates, 1);
  assert.equal(result.counts.recommendationUpdates, 1);
  assert.equal(result.counts.bothFieldUpdates, 1);
  assert.equal(result.proposals[0].customerComplaint, "Concern");
  assert.equal(result.proposals[0].recommendation, multiline);
});

test("blank source stays null, equal targets are idempotent, and differing nonblank targets fail closed", () => {
  const blank = planLegacyInvoiceConcernsBackfill({ invoices: [invoice("100")], headers: [header("100", " ", "")] });
  assert.equal(blank.counts.alreadyCurrent, 1);
  assert.equal(blank.proposals.length, 0);
  const equalInvoice = invoice("101", { customerComplaint: "Concern", recommendation: "Recommendation" });
  assert.equal(planLegacyInvoiceConcernsBackfill({ invoices: [equalInvoice], headers: [header("101")] }).counts.alreadyCurrent, 1);
  const conflict = planLegacyInvoiceConcernsBackfill({ invoices: [invoice("102", { customerComplaint: "Edited" })], headers: [header("102")] });
  assert.equal(conflict.counts.targetConflicts, 1);
  assert.equal(conflict.proposals.length, 0);
});

test("Customer, Vehicle, sold-date, and conflicting source headers each fail closed", () => {
  assert.equal(planLegacyInvoiceConcernsBackfill({ invoices: [invoice("100")], headers: [header("100", "C", "R", { legacyCustno: "99" })] }).counts.customerMismatches, 1);
  assert.equal(planLegacyInvoiceConcernsBackfill({ invoices: [invoice("100")], headers: [header("100", "C", "R", { legacyCarno: "99" })] }).counts.vehicleMismatches, 1);
  assert.equal(planLegacyInvoiceConcernsBackfill({ invoices: [invoice("100")], headers: [header("100", "C", "R", { dateSold: "20260814" })] }).counts.soldDateMismatches, 1);
  const conflict = planLegacyInvoiceConcernsBackfill({ invoices: [invoice("100")], headers: [header("100"), header("100", "Other", "Recommendation")] });
  assert.equal(conflict.counts.sourceConflicts, 1);
  assert.equal(conflict.proposals.length, 0);
});

test("exact aliases can validate recovered Customer identity", () => {
  const result = planLegacyInvoiceConcernsBackfill({
    invoices: [invoice("100", { customer: { legacyCustno: "canonical" } })], headers: [header("100", "C", "R", { legacyCustno: "alias" })],
    aliases: [{ aliasLegacyCustno: "alias", customerId: "customer" }],
  });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.counts.customerMismatches, 0);
});

test("four no-header imported records remain unchanged", () => {
  const invoices = ["1", "2", "3", "4"].map((ro) => invoice(ro));
  const result = planLegacyInvoiceConcernsBackfill({ invoices, headers: [] });
  assert.equal(result.counts.headersAbsent, 4);
  assert.equal(result.counts.unmatched, 4);
  assert.equal(result.proposals.length, 0);
});

test("writer SQL can update only the two text columns and fails on incomplete optimistic matches", async () => {
  let sql = "";
  const transaction = { $queryRawUnsafe: async (statement) => { sql = statement; return [{ id: "one" }]; } };
  const proposal = { ...planLegacyInvoiceConcernsBackfill({ invoices: [invoice("100")], headers: [header("100")] }).proposals[0], id: invoice("100").id };
  assert.deepEqual(await executeLegacyInvoiceConcernsBackfill({ transaction, shopId, proposals: [proposal] }), { updated: 1 });
  assert.match(sql, /SET customer_complaint = proposed\.new_complaint,[\s\S]*recommendation = proposed\.new_recommendation/);
  for (const forbidden of ["total =", "paid_total =", "parts_total =", "labor_total =", "tax_total =", "invoice_date =", "odometer =", "customer_id =", "vehicle_id =", "repair_order_id =", "updated_at ="]) assert.doesNotMatch(sql, new RegExp(forbidden));
  await assert.rejects(executeLegacyInvoiceConcernsBackfill({ transaction: { $queryRawUnsafe: async () => [] }, shopId, proposals: [proposal] }), /Concurrent Invoice text change/);
});

test("financial canonical control detects financial and relationship changes but ignores text", () => {
  const before = invoice("100");
  assert.equal(canonicalInvoiceControlHash([before]), canonicalInvoiceControlHash([{ ...before, customerComplaint: "new", recommendation: "new" }]));
  assert.notEqual(canonicalInvoiceControlHash([before]), canonicalInvoiceControlHash([{ ...before, total: "161.00" }]));
  assert.notEqual(canonicalInvoiceControlHash([before]), canonicalInvoiceControlHash([{ ...before, customerId: "other" }]));
});

test("main tool is Shop-scoped, legacy-only, snapshot-bound, and never loads native Invoices", async () => {
  const source = await readFile(new URL("./backfill-legacy-invoice-concerns.mjs", import.meta.url), "utf8");
  assert.match(source, /where: \{ shopId: options\.shopId, legacySourceTable: \{ not: null \} \}/);
  assert.match(source, /findUnique\(\{ where: \{ id: options\.shopId \}/);
  assert.match(source, /manifest\.snapshotDate !== ACCEPTED_SNAPSHOT_DATE/);
  assert.match(source, /await hashFile\(archive\) !== manifest\.zipSha256/);
  assert.match(source, /expected\.sha256 !== sha256\(bytes\)/);
  assert.match(source, /mkdir\(directory, \{ recursive: true, mode: 0o700 \}\)/);
  assert.match(source, /writeFile\(path, bytes, \{ flag: "wx", mode: 0o600 \}\)/);
});
