import { access, open, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { reconcileCustomerVehicleRows } from "./lib/customer-vehicle-transform.mjs";

const CONFIRMATION = "RESET_CAR_DOC_OPERATIONAL_DATA";
const REQUIRED_SOURCES = [
  "Cust.DBF", "vehicles.DBF", "FINAL.DBF", "laborfinal.DBF",
  "laborfinal.FPT", "ar.DBF", "orders.DBF", "LABORorder.DBF",
];
const DBF_SOURCES = REQUIRED_SOURCES.filter((name) => name.endsWith(".DBF"));
const PROTECTED_TABLES = [
  "shops", "canned_services", "audit_logs", "staff_invites", "shop_memberships",
  "customers", "vehicles", "repair_orders", "repair_order_parts", "repair_order_labor",
  "invoices", "invoice_parts", "invoice_labor", "payments", "accounts_receivable",
  "employees", "legacy_import_runs", "raw_legacy_customers", "raw_legacy_vehicles",
  "raw_legacy_final", "raw_legacy_labor_final", "raw_legacy_ar",
  "raw_legacy_order_parts", "raw_legacy_order_labor", "legacy_import_errors",
];
const OPERATIONAL_MODELS = [
  ["payments", "payment"],
  ["accounts_receivable", "accountReceivable"],
  ["invoice_parts", "invoicePart"],
  ["invoice_labor", "invoiceLabor"],
  ["invoices", "invoice"],
  ["repair_order_parts", "repairOrderPart"],
  ["repair_order_labor", "repairOrderLabor"],
  ["repair_orders", "repairOrder"],
  ["vehicles", "vehicle"],
  ["customers", "customer"],
  ["legacy_import_errors", "legacyImportError"],
  ["raw_legacy_customers", "rawLegacyCustomer"],
  ["raw_legacy_vehicles", "rawLegacyVehicle"],
  ["raw_legacy_final", "rawLegacyFinal"],
  ["raw_legacy_labor_final", "rawLegacyLaborFinal"],
  ["raw_legacy_ar", "rawLegacyAr"],
  ["raw_legacy_order_parts", "rawLegacyOrderPart"],
  ["raw_legacy_order_labor", "rawLegacyOrderLabor"],
  ["legacy_import_runs", "legacyImportRun"],
];
const OPERATIONAL_AUDIT_TYPES = [
  "customer", "vehicle", "repair_order", "repair_order_part", "repair_order_labor",
  "invoice", "payment", "accounts_receivable",
];
const legacyDecoder = new TextDecoder("windows-1252");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const flags = new Set(process.argv.slice(2).filter((value) => value.startsWith("--")));
const sourceArgument = argument("--source");
const wantsReset = flags.has("--reset-operational-data");
const wantsReload = flags.has("--reload-legacy");
const wantsSnapshot = flags.has("--snapshot");
const wantsVerify = flags.has("--verify");
const destructive = wantsReset || wantsReload;
const dryRun = flags.has("--dry-run") || !destructive;

function usage() {
  console.log("Usage: node --env-file=.env.local scripts/legacy-cutover.mjs [flags]");
  console.log("  --source <Shopman32/data path>");
  console.log("  --dry-run (default) | --snapshot | --verify");
  console.log("  --reset-operational-data --reload-legacy");
  console.log(`  --confirm ${CONFIRMATION}`);
}

async function sourceCounts(sourceFolder) {
  let validationIssues = 0;
  const counts = new Map();
  for (const filename of REQUIRED_SOURCES) {
    const path = resolve(sourceFolder, filename);
    try {
      await access(path, constants.R_OK);
      const info = await stat(path);
      if (!info.isFile()) throw new Error("not a file");
      if (filename.endsWith(".DBF")) {
        const handle = await open(path, "r");
        try {
          const header = Buffer.alloc(32);
          await handle.read(header, 0, header.length, 0);
          counts.set(filename, header.readUInt32LE(4));
        } finally {
          await handle.close();
        }
      }
    } catch {
      validationIssues += 1;
      counts.set(filename, null);
    }
  }
  let reconciliation = null;
  if (validationIssues === 0) {
    const [customerSource, vehicleSource] = await Promise.all([
      readDbfForReconciliation(resolve(sourceFolder, "Cust.DBF"), "customer"),
      readDbfForReconciliation(resolve(sourceFolder, "vehicles.DBF"), "vehicle"),
    ]);
    reconciliation = {
      ...reconcileCustomerVehicleRows(customerSource.rows, vehicleSource.rows),
      deletedCustomerRows: customerSource.deletedRows,
      deletedVehicleRows: vehicleSource.deletedRows,
    };
  }
  return { counts, validationIssues, reconciliation };
}

function dbfFields(file, headerLength) {
  const fields = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) break;
    const descriptor = file.subarray(offset, offset + 32);
    const nameEnd = descriptor.indexOf(0);
    const name = legacyDecoder.decode(descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd)).trim();
    const type = String.fromCharCode(descriptor[11]);
    const length = descriptor[16];
    fields.push({ name, type, length, recordOffset });
    recordOffset += length;
  }
  return fields;
}

function dbfValue(bytes, type) {
  if (["C", "N", "F", "D"].includes(type)) return legacyDecoder.decode(bytes).trim() || null;
  if (type === "I" && bytes.length === 4) return bytes.readInt32LE();
  return null;
}

function legacyIdentifier(rawData, candidates) {
  const entry = Object.entries(rawData).find(([key]) => candidates.includes(key.toUpperCase().replaceAll("_", "")));
  return entry?.[1] == null ? null : String(entry[1]).trim() || null;
}

async function readDbfForReconciliation(path, kind) {
  const file = await readFile(path);
  const recordCount = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const fields = dbfFields(file, headerLength);
  const rows = [];
  let deletedRows = 0;
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = file.subarray(start, start + recordLength);
    if (record.length !== recordLength) continue;
    if (record[0] === 0x2a) {
      deletedRows += 1;
      continue;
    }
    const rawData = {};
    for (const field of fields) {
      const bytes = record.subarray(field.recordOffset, field.recordOffset + field.length);
      rawData[field.name] = dbfValue(bytes, field.type);
    }
    rows.push({
      rawData,
      legacyCustno: legacyIdentifier(rawData, ["CUSTNO", "CUSTOMERNO"]),
      legacyCarno: kind === "vehicle" ? legacyIdentifier(rawData, ["CARNO", "VEHICLENO"]) : null,
    });
  }
  return { rows, deletedRows };
}

function printReconciliation(source, currentCounts) {
  const result = source.reconciliation;
  if (!result) return;
  const customerRaw = source.counts.get("Cust.DBF") ?? 0;
  const vehicleRaw = source.counts.get("vehicles.DBF") ?? 0;
  const customerSkipped = customerRaw - result.customers.length;
  const vehicleSkipped = vehicleRaw - result.vehicles.length;
  console.log("customer reconciliation");
  console.log(`raw source rows: ${customerRaw}`);
  console.log(`expected clean transformed rows: ${result.customers.length}`);
  console.log(`skipped/invalid rows: ${customerSkipped}`);
  console.log(`  source-deleted rows: ${result.deletedCustomerRows}`);
  console.log(`  invalid legacy id: ${result.reasons.invalidCustomerId}`);
  console.log(`  blank customer name: ${result.reasons.blankCustomerName}`);
  console.log(`  duplicate legacy id: ${result.reasons.duplicateCustomerId}`);
  console.log(`current database rows that would be deleted: ${currentCounts.customers}`);
  console.log(`current DB minus expected post-reload rows: ${currentCounts.customers - result.customers.length}`);
  console.log("vehicle reconciliation");
  console.log(`raw source rows: ${vehicleRaw}`);
  console.log(`expected clean transformed rows: ${result.vehicles.length}`);
  console.log(`skipped/invalid rows: ${vehicleSkipped}`);
  console.log(`  source-deleted rows: ${result.deletedVehicleRows}`);
  console.log(`  invalid legacy/customer id: ${result.reasons.invalidVehicleId}`);
  console.log(`  missing customer link: ${result.reasons.missingCustomerLink}`);
  console.log(`  duplicate legacy id: ${result.reasons.duplicateVehicleId}`);
  console.log(`current database rows that would be deleted: ${currentCounts.vehicles}`);
  console.log(`current DB minus expected post-reload rows: ${currentCounts.vehicles - result.vehicles.length}`);
  console.log("Raw DBF rows may be higher than clean imported rows because invalid, blank, duplicate, or unlinked legacy rows are skipped during transformation.");
}

async function databaseCounts(prisma, shopId) {
  return Object.fromEntries(await Promise.all(OPERATIONAL_MODELS.map(async ([table, model]) => [
    table,
    await prisma[model].count({ where: { shopId } }),
  ])));
}

async function preservedSnapshot(prisma, shopId) {
  const [shops, memberships, invites, services, employees, shop] = await Promise.all([
    prisma.shop.count(),
    prisma.shopMembership.count({ where: { shopId } }),
    prisma.staffInvite.count({ where: { shopId } }),
    prisma.cannedService.count({ where: { shopId } }),
    prisma.employee.count({ where: { shopId } }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        defaultTaxRate: true, defaultLaborRate: true, partsTaxable: true,
        laborTaxable: true, invoiceFooterMessage: true, warrantyText: true,
        nextRepairOrderNumber: true,
      },
    }),
  ]);
  return { shops, memberships, invites, services, employees, settings: JSON.stringify(shop) };
}

function printCounts(label, counts) {
  console.log(label);
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count}`);
}

async function runScript(script, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve("scripts", script), ...args], {
      cwd: process.cwd(), env: process.env, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${script} failed with exit code ${code}.`)));
  });
}

async function resetOperationalData(prisma, shopId) {
  await prisma.$transaction(async (transaction) => {
    await transaction.auditLog.deleteMany({
      where: { shopId, entityType: { in: OPERATIONAL_AUDIT_TYPES } },
    });
    for (const [, model] of OPERATIONAL_MODELS) {
      await transaction[model].deleteMany({ where: { shopId } });
    }
  }, { maxWait: 10_000, timeout: 120_000 });
}

async function reloadLegacy(sourceFolder, shopId) {
  const common = ["--source", sourceFolder, "--shop-id", shopId];
  await runScript("import-customers-vehicles.mjs", common);
  await runScript("transform-customers-vehicles.mjs", ["--shop-id", shopId]);
  await runScript("import-invoices.mjs", common);
  await runScript("transform-invoices.mjs", ["--shop-id", shopId]);
  await runScript("import-open-orders.mjs", common);
  await runScript("transform-open-orders.mjs", ["--shop-id", shopId]);
}

async function verify(prisma, shopId, preservedBefore) {
  const counts = await databaseCounts(prisma, shopId);
  printCounts("post-load counts", counts);
  const imported = await Promise.all([
    prisma.customer.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.invoice.count({ where: { shopId, legacySourceTable: { not: null } } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: { not: null } } }),
  ]);
  const webCreated = await Promise.all([
    prisma.customer.count({ where: { shopId, legacySourceTable: null } }),
    prisma.vehicle.count({ where: { shopId, legacySourceTable: null } }),
    prisma.invoice.count({ where: { shopId, legacySourceTable: null } }),
    prisma.repairOrder.count({ where: { shopId, legacySourceTable: null } }),
  ]);
  console.log(`imported legacy records: ${imported.reduce((sum, count) => sum + count, 0)}`);
  console.log(`web-created test records: ${webCreated.reduce((sum, count) => sum + count, 0)}`);

  const security = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS protected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
      AND c.relrowsecurity
      AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  `, PROTECTED_TABLES);
  console.log(`RLS/API protected tables: ${security[0]?.protected ?? 0}/${PROTECTED_TABLES.length}`);
  console.log("server-side Prisma query works: 1");
  if (preservedBefore) {
    const after = await preservedSnapshot(prisma, shopId);
    console.log(`shop/admin/user/settings records preserved: ${JSON.stringify(after) === JSON.stringify(preservedBefore) ? 1 : 0}`);
  }
}

async function main() {
  if (flags.has("--help")) return usage();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  if (destructive && !dryRun && argument("--confirm") !== CONFIRMATION) {
    throw new Error(`Destructive operation blocked. Provide --confirm ${CONFIRMATION}.`);
  }
  if (wantsReload && !sourceArgument) throw new Error("--source is required for legacy reload.");

  const sourceFolder = sourceArgument ? resolve(sourceArgument) : null;
  const source = sourceFolder ? await sourceCounts(sourceFolder) : null;
  if (source) {
    for (const filename of DBF_SOURCES) console.log(`${filename} rows available: ${source.counts.get(filename) ?? "unavailable"}`);
    console.log(`source validation issue count: ${source.validationIssues}`);
    if (source.validationIssues > 0) throw new Error("Required source files are missing or unreadable.");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const shop = await prisma.shop.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!shop) throw new Error("No shop is configured.");
    console.log("database connection works: 1");
    const preservedBefore = await preservedSnapshot(prisma, shop.id);
    const before = await databaseCounts(prisma, shop.id);
    if (wantsSnapshot || wantsReset || (dryRun && !wantsVerify)) {
      printCounts(dryRun ? "rows that would be deleted" : "pre-reset snapshot", before);
    }
    if (dryRun && source) printReconciliation(source, before);

    if (dryRun) {
      const after = await databaseCounts(prisma, shop.id);
      console.log("mode: dry-run");
      console.log("database writes performed: 0");
      console.log(`dry-run operational row counts unchanged: ${JSON.stringify(after) === JSON.stringify(before) ? 1 : 0}`);
      if (wantsVerify) await verify(prisma, shop.id, preservedBefore);
      return;
    }

    if (wantsReset) await resetOperationalData(prisma, shop.id);
    if (wantsReload) await reloadLegacy(sourceFolder, shop.id);
    if (wantsReload) {
      await prisma.auditLog.create({
        data: {
          shopId: shop.id, action: "legacy_cutover_completed", entityType: "shop",
          entityId: shop.id, entityLabel: "Legacy cutover", entityHref: "/admin/data-tools",
          contextSummary: "Operational data reloaded from approved legacy source",
          metadata: { sourceType: "Shopman32 DBF", driver: "legacy-cutover" },
        },
      });
    }
    if (wantsVerify || wantsReload) await verify(prisma, shop.id, preservedBefore);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`legacy cutover failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
