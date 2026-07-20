import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { assertApplicationCreatedGraph, executeCleanup, orphanDecisions, parseCleanupArguments, requireSingleMatch, runConfirmedCleanup } from "./lib/test-ro-cleanup.mjs";

const execFileAsync = promisify(execFile);
const args = parseCleanupArguments(process.argv.slice(2));
const databaseUrl = process.env.DIRECT_URL;
if (!databaseUrl) throw new Error("Cleanup failed: DIRECT_URL is not configured.");

function json(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object" && typeof item.toJSON === "function") return item.toJSON();
    return item;
  }, 2) + "\n";
}

async function loadGraph(client, shop, roNumber) {
  const matches = await client.repairOrder.findMany({
    where: { shopId: shop.id, repairOrderNumber: roNumber },
    include: { parts: true, labor: true, customer: true, vehicle: true, invoices: { include: { parts: true, labor: true, payments: true, accountsReceivable: true, legacyCharges: true } } },
  });
  const repairOrder = requireSingleMatch(matches, roNumber);
  if (repairOrder.invoices.length > 1) throw new Error(`Repair Order ${roNumber} has ${repairOrder.invoices.length} invoices; cleanup refused.`);
  const invoice = repairOrder.invoices[0] ?? null;
  const invoiceIds = invoice ? [invoice.id] : [];
  const relatedEntityIds = [repairOrder.id, ...repairOrder.parts.map(({ id }) => id), ...repairOrder.labor.map(({ id }) => id), ...(invoice ? [invoice.id, ...invoice.parts.map(({ id }) => id), ...invoice.labor.map(({ id }) => id), ...invoice.payments.map(({ id }) => id), ...invoice.accountsReceivable.map(({ id }) => id), ...invoice.legacyCharges.map(({ id }) => id)] : [])];
  const [vehicleOtherRepairOrders, vehicleOtherInvoices, customerOtherRepairOrders, customerOtherInvoices, customerOtherPayments, customerOtherReceivables, customerAliases, customerVehicles, auditLogs] = await Promise.all([
    client.repairOrder.count({ where: { shopId: shop.id, vehicleId: repairOrder.vehicleId, id: { not: repairOrder.id } } }),
    client.invoice.count({ where: { shopId: shop.id, vehicleId: repairOrder.vehicleId, id: { notIn: invoiceIds } } }),
    client.repairOrder.count({ where: { shopId: shop.id, customerId: repairOrder.customerId, id: { not: repairOrder.id } } }),
    client.invoice.count({ where: { shopId: shop.id, customerId: repairOrder.customerId, id: { notIn: invoiceIds } } }),
    client.payment.count({ where: { shopId: shop.id, customerId: repairOrder.customerId, OR: [{ invoiceId: null }, { invoiceId: { notIn: invoiceIds } }] } }),
    client.accountReceivable.count({ where: { shopId: shop.id, customerId: repairOrder.customerId, OR: [{ invoiceId: null }, { invoiceId: { notIn: invoiceIds } }] } }),
    client.customerLegacyAlias.count({ where: { shopId: shop.id, customerId: repairOrder.customerId } }),
    client.vehicle.count({ where: { shopId: shop.id, customerId: repairOrder.customerId } }),
    client.auditLog.findMany({ where: { shopId: shop.id, entityId: { in: relatedEntityIds } } }),
  ]);
  return { shop, repairOrder, invoice, customer: repairOrder.customer, vehicle: repairOrder.vehicle, references: { vehicleOtherRepairOrders, vehicleOtherInvoices, customerOtherRepairOrders, customerOtherInvoices, customerOtherPayments, customerOtherReceivables, customerAliases, customerVehicles }, retainedAuditLogs: auditLogs };
}

function affectedRows(graph) {
  return { repair_orders: [graph.repairOrder], repair_order_parts: graph.repairOrder.parts, repair_order_labor: graph.repairOrder.labor, invoices: graph.invoice ? [graph.invoice] : [], invoice_parts: graph.invoice?.parts ?? [], invoice_labor: graph.invoice?.labor ?? [], payments: graph.invoice?.payments ?? [], accounts_receivable: graph.invoice?.accountsReceivable ?? [], invoice_legacy_charges: graph.invoice?.legacyCharges ?? [], customers: [graph.customer], vehicles: [graph.vehicle], retained_audit_logs: graph.retainedAuditLogs };
}

async function backup(graph, decisions) {
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
  const directory = join(homedir(), "Projects", "Web", "plumworks-backups", "cardoc", "test-ro-cleanup", `${timestamp}-ro-${args.roNumber}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const rows = json(affectedRows(graph));
  const rowsFile = join(directory, "affected-records.json");
  await writeFile(rowsFile, rows, { mode: 0o600, flag: "wx" });
  const checksum = createHash("sha256").update(rows).digest("hex");
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() });
  const manifest = { createdAt: new Date().toISOString(), gitCommit: stdout.trim(), shopId: graph.shop.id, repairOrderNumber: args.roNumber, repairOrderId: graph.repairOrder.id, files: [{ name: "affected-records.json", sha256: checksum }], decisions, retainedAuditLogCount: graph.retainedAuditLogs.length, credentialsStored: false };
  const manifestFile = join(directory, "deletion-plan.json");
  await writeFile(manifestFile, json(manifest), { mode: 0o600, flag: "wx" });
  await Promise.all([chmod(rowsFile, 0o600), chmod(manifestFile, 0o600)]);
  return { directory, checksum };
}

function printPlan(graph, decisions) {
  const rows = affectedRows(graph);
  const cents = (value) => {
    const match = String(value ?? 0).match(/^(-?)(\d+)(?:\.(\d{0,2}))?$/);
    if (!match) throw new Error(`Unexpected money value: ${value}`);
    const amount = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
    return match[1] ? -amount : amount;
  };
  const money = (value) => `$${(value / 100).toFixed(2)}`;
  const paymentTotal = (graph.invoice?.payments ?? []).reduce((sum, payment) => sum + cents(payment.amount), 0);
  const receivableTotal = (graph.invoice?.accountsReceivable ?? []).reduce((sum, row) => sum + cents(row.balance), 0);
  const legacyChargeTotal = (graph.invoice?.legacyCharges ?? []).reduce((sum, row) => sum + cents(row.amount), 0);
  console.log(`Shop: ${graph.shop.name} (${graph.shop.id})`);
  console.log(`Repair Order: ${args.roNumber} (${graph.repairOrder.id})`);
  console.log(`Customer: ${graph.customer.displayName} (${graph.customer.id})`);
  console.log(`Vehicle: ${[graph.vehicle.year, graph.vehicle.make, graph.vehicle.model].filter(Boolean).join(" ")} (${graph.vehicle.id})`);
  console.log(`Invoice: ${graph.invoice ? `${graph.invoice.repairOrderNumber ?? "unnumbered"} (${graph.invoice.id}), status ${graph.invoice.status}` : "none"}`);
  console.log(`Legacy/imported: Repair Order ${graph.repairOrder.legacySourceTable || graph.repairOrder.legacyRoNo ? "yes" : "no"}; Invoice ${graph.invoice && (graph.invoice.legacySourceTable || graph.invoice.legacyRoNo) ? "yes" : "no"}`);
  for (const [table, records] of Object.entries(rows)) console.log(`${table}: ${records.length}`);
  console.log(`Repair Order totals: parts ${money(cents(graph.repairOrder.partsTotal))}; labor ${money(cents(graph.repairOrder.laborTotal))}; tax ${money(cents(graph.repairOrder.taxTotal))}; estimated ${money(cents(graph.repairOrder.estimatedTotal))}`);
  if (graph.invoice) console.log(`Invoice totals: parts ${money(cents(graph.invoice.partsTotal))}; labor ${money(cents(graph.invoice.laborTotal))}; supplies ${money(cents(graph.invoice.shopSuppliesAmount))}; tax ${money(cents(graph.invoice.taxTotal))}; total ${money(cents(graph.invoice.total))}; paid ${money(cents(graph.invoice.paidTotal))}`);
  console.log(`Payments total: ${money(paymentTotal)}`);
  console.log(`Accounts Receivable balance total: ${money(receivableTotal)}`);
  console.log(`Invoice legacy-charge total: ${money(legacyChargeTotal)}`);
  console.log(`Retained audit logs: ${graph.retainedAuditLogs.length}`);
  console.log(`Customer references: ${JSON.stringify(graph.references)}`);
  console.log(`Vehicle: ${decisions.deleteVehicle ? "delete" : `retain (${decisions.vehicleReasons.join("; ")})`}`);
  console.log(`Customer: ${decisions.deleteCustomer ? "delete" : `retain (${decisions.customerReasons.join("; ")})`}`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const shops = await prisma.shop.findMany({ select: { id: true, name: true } });
  if (shops.length !== 1) throw new Error(`Cleanup requires exactly one configured shop; found ${shops.length}.`);
  const graph = await loadGraph(prisma, shops[0], args.roNumber);
  assertApplicationCreatedGraph(graph);
  const decisions = orphanDecisions(graph, args);
  printPlan(graph, decisions);
  if (args.dryRun) {
    console.log("No database changes performed.");
  } else {
    const completed = await runConfirmedCleanup({ createBackup: () => backup(graph, decisions), transaction: () => prisma.$transaction(async (transaction) => {
      const current = await loadGraph(transaction, shops[0], args.roNumber);
      assertApplicationCreatedGraph(current);
      const currentRows = json(affectedRows(current));
      const originalRows = json(affectedRows(graph));
      if (createHash("sha256").update(currentRows).digest("hex") !== createHash("sha256").update(originalRows).digest("hex")) throw new Error("Related records changed after backup; deletion rolled back.");
      const currentDecisions = orphanDecisions(current, args);
      if (JSON.stringify(currentDecisions) !== JSON.stringify(decisions)) throw new Error("Customer or Vehicle references changed after backup; deletion rolled back.");
      return executeCleanup(transaction, current, currentDecisions);
    }, { isolationLevel: "Serializable" }) });
    const checkpoint = completed.checkpoint;
    const deleted = completed.result;
    console.log(`Backup: ${checkpoint.directory}`);
    console.log(`Affected-record checksum: ${checkpoint.checksum}`);
    console.log(`Deleted: ${JSON.stringify(deleted)}`);
    console.log(`Vehicle ${decisions.deleteVehicle ? "deleted" : "retained"}.`);
    console.log(`Customer ${decisions.deleteCustomer ? "deleted" : "retained"}.`);
  }
} finally {
  await prisma.$disconnect();
}
