import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteOperationalData, OPERATIONAL_MODELS } from "./lib/legacy-cutover-reset.mjs";

const preservedModels = [
  "shop", "shopMembership", "staffInvite", "employee", "vendor", "cannedService",
  "marketingSetting", "marketingPage", "marketingService", "marketingCoupon",
  "marketingTestimonial", "marketingGalleryItem", "marketingLead",
];

function transactionRecorder({ failAt } = {}) {
  const calls = [];
  const models = new Set(["auditLog", ...OPERATIONAL_MODELS.map(([, model]) => model), ...preservedModels]);
  const transaction = Object.fromEntries([...models].map((model) => [model, {
    deleteMany: async (args) => {
      calls.push({ model, args });
      if (model === failAt) throw new Error("synthetic reset failure");
      return { count: model === "customerLegacyAlias" ? 6 : 1 };
    },
  }]));
  return { transaction, calls };
}

test("reset removes aliases before restrictive parent Customers and leaves preserved models untouched", async () => {
  const { transaction, calls } = transactionRecorder();
  await deleteOperationalData(transaction, "shop-1");
  const models = calls.map(({ model }) => model);
  assert.ok(models.indexOf("customerLegacyAlias") < models.indexOf("customer"));
  assert.ok(models.indexOf("vehicle") < models.indexOf("customer"));
  assert.equal(models.filter((model) => model === "customerLegacyAlias").length, 1);
  for (const model of preservedModels) assert.equal(models.includes(model), false);
  for (const { args } of calls) assert.equal(args.where.shopId, "shop-1");
});

test("six or more restrictive aliases cannot block Customer deletion", async () => {
  let aliases = 8;
  let customers = 3;
  const { transaction } = transactionRecorder();
  transaction.customerLegacyAlias.deleteMany = async () => { aliases = 0; return { count: 8 }; };
  transaction.customer.deleteMany = async () => {
    if (aliases !== 0) throw new Error("restrictive alias FK would block Customers");
    customers = 0;
    return { count: 3 };
  };
  await deleteOperationalData(transaction, "shop-1");
  assert.equal(aliases, 0);
  assert.equal(customers, 0);
});

test("InvoiceLegacyCharge relies on its proven cascade and is not independently broadened into reset scope", async () => {
  const schema = await readFile("prisma/schema.prisma", "utf8");
  const migration = await readFile("prisma/migrations/20260719120000_add_shop_supplies_financial_fields/migration.sql", "utf8");
  assert.match(schema, /model InvoiceLegacyCharge[\s\S]*?invoice\s+Invoice\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(migration, /invoice_legacy_charges_invoice_id_fkey[\s\S]*?ON DELETE CASCADE/);
  assert.equal(OPERATIONAL_MODELS.some(([, model]) => model === "invoiceLegacyCharge"), false);
  assert.ok(OPERATIONAL_MODELS.findIndex(([, model]) => model === "invoice") >= 0);
});

test("a failed delete rejects the single surrounding transaction so no partial reset can commit", async () => {
  const state = { committed: ["baseline"], transactions: 0 };
  const prisma = { $transaction: async (callback) => {
    state.transactions += 1;
    const working = [...state.committed];
    const { transaction } = transactionRecorder({ failAt: "customer" });
    await assert.rejects(callback(transaction), /synthetic reset failure/);
    assert.deepEqual(state.committed, ["baseline"]);
    assert.deepEqual(working, ["baseline"]);
    throw new Error("transaction rolled back");
  } };
  await assert.rejects(prisma.$transaction((transaction) => deleteOperationalData(transaction, "shop-1")), /transaction rolled back/);
  assert.equal(state.transactions, 1);
});

test("cutover keeps authoritative backup gate before its one reset transaction", async () => {
  const source = await readFile("scripts/legacy-cutover.mjs", "utf8");
  const gate = source.indexOf("requireVerifiedBackupGate(verifiedBackupGate");
  const transaction = source.indexOf("await prisma.$transaction", gate);
  const deletion = source.indexOf("await deleteOperationalData", transaction);
  assert.ok(gate >= 0 && gate < transaction && transaction < deletion);
  assert.equal((source.match(/async function resetOperationalData/g) ?? []).length, 1);
});
