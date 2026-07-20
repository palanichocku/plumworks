import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertApplicationCreatedGraph, executeCleanup, legacyMarker, orphanDecisions, parseCleanupArguments, requireSingleMatch, runConfirmedCleanup } from "./lib/test-ro-cleanup.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function graph({ invoice = true, legacyRo = false, legacyInvoice = false, references = {} } = {}) {
  const customer = { id: "customer", shopId: "shop", displayName: "Test Customer", legacyCustno: null, legacySourceTable: null };
  const vehicle = { id: "vehicle", shopId: "shop", customerId: customer.id, legacyCarno: null, legacySourceTable: null };
  return {
    shop: { id: "shop", name: "Car Doc" }, customer, vehicle,
    repairOrder: { id: "ro", shopId: "shop", customerId: customer.id, vehicleId: vehicle.id, legacyRoNo: legacyRo ? "12" : null, legacySourceTable: null, parts: [{ id: "rp", legacyLineKey: "web:part" }], labor: [{ id: "rl", legacyLineKey: "web:labor" }] },
    invoice: invoice ? { id: "invoice", legacyRoNo: null, legacySourceTable: legacyInvoice ? "ar.DBF" : null, parts: [{ id: "ip", legacyLineKey: "web:invoice:part" }], labor: [{ id: "il", legacyLineKey: "web:invoice:labor" }], payments: [{ id: "payment", amount: "10.00", legacyRoNo: null, legacySourceTable: null }], accountsReceivable: [{ id: "ar", legacyRoNo: null, legacySourceTable: null }], legacyCharges: [] } : null,
    references: { vehicleOtherRepairOrders: 0, vehicleOtherInvoices: 0, customerOtherRepairOrders: 0, customerOtherInvoices: 0, customerOtherPayments: 0, customerOtherReceivables: 0, customerAliases: 0, customerVehicles: 1, ...references }, retainedAuditLogs: [],
  };
}

test("arguments are dry-run by default and exact confirmation is required", () => {
  assert.equal(parseCleanupArguments(["--ro", "12345"]).dryRun, true);
  assert.equal(parseCleanupArguments(["--ro", "12345", "--confirm", "DELETE_TEST_RO_12345"]).dryRun, false);
  assert.throws(() => parseCleanupArguments([]), /--ro/);
  assert.throws(() => parseCleanupArguments(["--ro", "12345", "--confirm", "WRONG"]), /DELETE_TEST_RO_12345/);
});

test("unknown and ambiguous Repair Orders are rejected", () => {
  assert.throws(() => requireSingleMatch([], 12), /not found/);
  assert.throws(() => requireSingleMatch([{}, {}], 12), /ambiguous/);
  assert.equal(requireSingleMatch([{ id: "one" }], 12).id, "one");
});

test("legacy Repair Orders, invoices, and line identities are never deletable", () => {
  assert.throws(() => assertApplicationCreatedGraph(graph({ legacyRo: true })), /Legacy protection/);
  assert.throws(() => assertApplicationCreatedGraph(graph({ legacyInvoice: true })), /Legacy protection/);
  assert.equal(legacyMarker({ legacyLineKey: "web:invoice:part" }), null);
  assert.match(legacyMarker({ legacyLineKey: "FINAL:1" }), /legacyLineKey/);
});

test("Customer and Vehicle are retained unless explicit orphan flags are safe", () => {
  const kept = orphanDecisions(graph(), {});
  assert.equal(kept.deleteVehicle, false);
  assert.equal(kept.deleteCustomer, false);
  const deleted = orphanDecisions(graph(), { deleteOrphanVehicle: true, deleteOrphanCustomer: true });
  assert.equal(deleted.deleteVehicle, true);
  assert.equal(deleted.deleteCustomer, true);
  assert.equal(orphanDecisions(graph({ references: { vehicleOtherInvoices: 1 } }), { deleteOrphanVehicle: true }).deleteVehicle, false);
  assert.equal(orphanDecisions(graph({ references: { customerAliases: 1 } }), { deleteOrphanVehicle: true, deleteOrphanCustomer: true }).deleteCustomer, false);
});

test("cleanup handles a Repair Order without an invoice", async () => {
  const calls = [];
  const transaction = mockTransaction(calls);
  const deleted = await executeCleanup(transaction, graph({ invoice: false }), { deleteVehicle: false, deleteCustomer: false });
  assert.equal(deleted.repairOrders, 1);
  assert.doesNotMatch(calls.join(","), /invoice\.delete/);
});

test("invoice, AR, lines, and payments use explicit foreign-key deletion order", async () => {
  const calls = [];
  await executeCleanup(mockTransaction(calls), graph(), { deleteVehicle: false, deleteCustomer: false });
  assert.deepEqual(calls, ["payment.deleteMany", "accountReceivable.deleteMany", "invoiceLegacyCharge.deleteMany", "invoicePart.deleteMany", "invoiceLabor.deleteMany", "invoice.delete", "repairOrderPart.deleteMany", "repairOrderLabor.deleteMany", "repairOrder.delete"]);
});

test("backup must complete before the single transaction and backup failure prevents deletion", async () => {
  const order = [];
  await runConfirmedCleanup({ createBackup: async () => { order.push("backup"); return { checksum: "safe" }; }, transaction: async () => { order.push("transaction"); return {}; } });
  assert.deepEqual(order, ["backup", "transaction"]);
  let transactionRan = false;
  await assert.rejects(runConfirmedCleanup({ createBackup: async () => { throw new Error("backup failed"); }, transaction: async () => { transactionRan = true; } }), /backup failed/);
  assert.equal(transactionRan, false);
});

test("implementation uses one transaction, has no timestamp provenance guessing, and stores no credentials", async () => {
  const [script, helper] = await Promise.all([read("scripts/cleanup-test-repair-order.mjs"), read("scripts/lib/test-ro-cleanup.mjs")]);
  assert.equal((script.match(/prisma\.\$transaction/g) ?? []).length, 1);
  assert.doesNotMatch(helper, /createdAt|updatedAt/);
  assert.match(script, /credentialsStored: false/);
  assert.doesNotMatch(script, /connectionString[^\n]*manifest|DIRECT_URL[^\n]*writeFile/);
  assert.match(script, /mode: 0o700/);
  assert.match(script, /mode: 0o600/);
  assert.match(script, /No database changes performed\./);
});

function mockTransaction(calls) {
  const deleteMany = (name) => async () => { calls.push(`${name}.deleteMany`); return { count: 1 }; };
  const remove = (name) => async () => { calls.push(`${name}.delete`); return {}; };
  return {
    payment: { deleteMany: deleteMany("payment") }, accountReceivable: { deleteMany: deleteMany("accountReceivable") }, invoiceLegacyCharge: { deleteMany: deleteMany("invoiceLegacyCharge") }, invoicePart: { deleteMany: deleteMany("invoicePart") }, invoiceLabor: { deleteMany: deleteMany("invoiceLabor") }, invoice: { delete: remove("invoice") }, repairOrderPart: { deleteMany: deleteMany("repairOrderPart") }, repairOrderLabor: { deleteMany: deleteMany("repairOrderLabor") }, repairOrder: { delete: remove("repairOrder") }, vehicle: { delete: remove("vehicle") }, customer: { delete: remove("customer") },
  };
}
