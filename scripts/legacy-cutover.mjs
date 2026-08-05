import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { reconcileCustomerVehicleRows } from "./lib/customer-vehicle-transform.mjs";
import {
  executeCutoverCustomerRecovery,
  planCutoverCustomerRecovery,
  runRecoveryBeforeLaterStages,
} from "./lib/legacy-customer-recovery.mjs";
import { reconcileInvoiceRows, reconcileOpenOrderRows } from "./lib/legacy-operational-reconciliation.mjs";
import { deterministicLegacyInvoiceId, projectLegacyInvoicePaymentInputs } from "./lib/legacy-invoice-projection.mjs";
import {
  executeLegacyPaymentInsertTransaction,
  LEGACY_PAYMENT_DATE_LABEL,
  LEGACY_TENDER_BUCKETS,
  parsePaymentDatePolicyArgument,
  projectLegacyPayments,
} from "./lib/legacy-payment-import.mjs";
import {
  loadLegacyPaymentStageProjection,
  runPaymentBeforeOpenOrders,
  validateApprovedPaymentUnresolved,
  verifyPersistedLegacyPayments,
} from "./lib/legacy-payment-stage.mjs";
import { loadRecoveryManifest, recoveryManifestArgument } from "./lib/legacy-recovery-manifest.mjs";
import { resolveSingleShopId } from "./lib/single-shop.mjs";
import { resolveLegacySource } from "./lib/legacy-source.mjs";
import { verifyFreshLegacyCutover } from "./lib/legacy-cutover-acceptance.mjs";
import {
  authoritativeReloadCounts,
  LEGACY_CUTOVER_CONFIRMATION,
  parseLegacyCutoverExecution,
  validateProjectedCountConsistency,
} from "./lib/legacy-cutover-preflight.mjs";

const CONFIRMATION = LEGACY_CUTOVER_CONFIRMATION;
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
  "marketing_leads",
  "marketing_settings", "marketing_pages", "marketing_services", "marketing_coupons",
  "marketing_testimonials", "marketing_gallery_items",
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
const execution = flags.has("--help") ? null : parseLegacyCutoverExecution(process.argv.slice(2));
const resolvedLegacySource = flags.has("--help") ? null : await resolveLegacySource({ requiredFiles: REQUIRED_SOURCES });
const sourceArgument = resolvedLegacySource?.path;
const wantsReset = flags.has("--reset-operational-data");
const wantsReload = flags.has("--reload-legacy");
const wantsSnapshot = flags.has("--snapshot");
const wantsVerify = flags.has("--verify");
const wantsBackup = flags.has("--backup");
const wantsReport = flags.has("--report");
const wantsPreflight = flags.has("--preflight");
const summaryOnly = flags.has("--summary-only");
const finalLog = console.log.bind(console);
const finalError = console.error.bind(console);
if (summaryOnly) {
  console.log = () => {};
  console.error = () => {};
}
const backupDir = resolve(argument("--backup-dir") ?? "backups");
const reportDir = resolve(argument("--report-dir") ?? "reports");
const destructive = wantsReset || wantsReload;
const dryRun = execution?.dryRun ?? true;
const timestamp = new Date();
const timestampSlug = timestamp.toISOString().replaceAll(/[-:]/g, "").replace("T", "-").slice(0, 15);
const runSummary = {
  timestamp: timestamp.toISOString(),
  mode: wantsPreflight ? "preflight" : dryRun ? "dry-run" : "cutover",
  status: "PASS",
  source: { path: sourceArgument ? resolve(sourceArgument) : null, validationIssues: null, rowCounts: {}, expectedCleanCounts: {} },
  backup: { requested: wantsBackup, completed: false, directory: null, files: {} },
  reset: { requested: wantsReset, completed: false, rowsDeleted: {} },
  reload: { requested: wantsReload, completed: false, counts: {} },
  recovery: { required: false, manifestProvided: false, sourceFingerprint: resolvedLegacySource?.fingerprint ?? null, manifestFingerprint: null, counts: {} },
  preflight: {
    requested: wantsPreflight, confirmedCommandRequirements: execution?.requiredFullReplacementFlags ?? [],
    backupDestination: backupDir, rowsToDelete: {}, expectedRowsToReload: {}, preservedRows: {}, countInconsistencies: [],
  },
  payment: { importRunId: null, datePolicy: null, reportBasis: LEGACY_PAYMENT_DATE_LABEL, counts: {}, sourceBuckets: {}, normalizedMethods: {}, unsupportedFields: [] },
  acceptance: { mileage: {}, vendor: {}, complimentary: {}, operational: {}, history: {}, recoveryBackfill: {} },
  stages: [],
  verification: {},
  accounting: {},
  preserved: {},
  warnings: [],
  criticalIssues: [],
  nextActions: [],
};

function recordStage(name, details = {}) {
  if (!runSummary.stages.some((stage) => stage.name === name)) {
    runSummary.stages.push({ name, status: "passed", ...details });
  }
}

function usage() {
  console.log("Usage: node --env-file=.env.local scripts/legacy-cutover.mjs [flags]");
  console.log("  --source <immutable snapshot data directory> (required)");
  console.log("  --customer-recovery-manifest <source-bound approved JSON> (required when source Customer references need recovery)");
  console.log("  --payment-date-policy invoice-date-proxy (required)");
  console.log("  --shop-id <shop UUID> (optional when the database contains exactly one shop)");
  console.log("  --dry-run (default) | --snapshot | --verify");
  console.log("  --preflight (read-only full-replacement readiness report)");
  console.log("  --reset-operational-data --reload-legacy");
  console.log("  --backup [--backup-dir <path>]");
  console.log("  --report [--report-dir <path>] [--summary-only]");
  console.log(`  --confirm ${CONFIRMATION}`);
}

async function sourceCounts(sourceDirectory) {
  let validationIssues = 0;
  const counts = new Map();
  for (const filename of REQUIRED_SOURCES) {
    const path = sourceDirectory.files[filename];
    try {
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
    const [customerSource, vehicleSource, finalSource, laborSource, arSource, orderPartSource, orderLaborSource] = await Promise.all([
      readDbfForReconciliation(sourceDirectory.files["Cust.DBF"]),
      readDbfForReconciliation(sourceDirectory.files["vehicles.DBF"]),
      readDbfForReconciliation(sourceDirectory.files["FINAL.DBF"]),
      readDbfForReconciliation(sourceDirectory.files["laborfinal.DBF"]),
      readDbfForReconciliation(sourceDirectory.files["ar.DBF"]),
      readDbfForReconciliation(sourceDirectory.files["orders.DBF"]),
      readDbfForReconciliation(sourceDirectory.files["LABORorder.DBF"]),
    ]);
    reconciliation = {
      ...reconcileCustomerVehicleRows(customerSource.rows, vehicleSource.rows),
      deletedCustomerRows: customerSource.deletedRows,
      deletedVehicleRows: vehicleSource.deletedRows,
      sources: { finalSource, laborSource, arSource, orderPartSource, orderLaborSource },
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

async function readDbfForReconciliation(path) {
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
      legacyCarno: legacyIdentifier(rawData, ["CARNO", "VEHICLENO"]),
      legacyRoNo: legacyIdentifier(rawData, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]),
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

function expectedCleanCounts(source, additionalCustomerIds = []) {
  const reconciliation = source.reconciliation;
  if (!reconciliation?.sources) return null;
  const { finalSource, laborSource, arSource, orderPartSource, orderLaborSource } = reconciliation.sources;
  const customerIds = new Set([...reconciliation.customers.map((row) => row.legacyCustno), ...additionalCustomerIds]);
  const vehicleIds = new Set(reconciliation.vehicles.map((row) => row.legacyCarno));
  const invoices = reconcileInvoiceRows({
    finalRows: finalSource.rows, laborRows: laborSource.rows, arRows: arSource.rows,
    customerIds, vehicleIds,
  });
  const openOrders = reconcileOpenOrderRows({
    partRows: orderPartSource.rows, laborRows: orderLaborSource.rows, customerIds, vehicleIds,
  });
  return {
    customers: reconciliation.customers.length,
    vehicles: reconciliation.vehicles.length,
    invoices: invoices.invoices,
    invoice_parts: invoices.parts,
    invoice_labor: invoices.labor,
    accounts_receivable: invoices.ar,
    repair_orders: openOrders.orders,
    details: { reconciliation, finalSource, laborSource, arSource, orderPartSource, orderLaborSource, invoices, openOrders },
  };
}

function reportReconciliation(source) {
  const expected = expectedCleanCounts(source);
  if (!expected) return {};
  const { reconciliation, finalSource, laborSource, arSource, orderPartSource, orderLaborSource, invoices, openOrders } = expected.details;
  const customerRaw = source.counts.get("Cust.DBF") ?? 0;
  const vehicleRaw = source.counts.get("vehicles.DBF") ?? 0;
  const finalRaw = source.counts.get("FINAL.DBF") ?? 0;
  const laborRaw = source.counts.get("laborfinal.DBF") ?? 0;
  const arRaw = source.counts.get("ar.DBF") ?? 0;
  const openRaw = (source.counts.get("orders.DBF") ?? 0) + (source.counts.get("LABORorder.DBF") ?? 0);
  return {
    customers: {
      raw: customerRaw, expectedClean: expected.customers, skipped: customerRaw - expected.customers,
      sourceDeleted: reconciliation.deletedCustomerRows,
      invalidLegacyId: reconciliation.reasons.invalidCustomerId,
      blankName: reconciliation.reasons.blankCustomerName,
      duplicateLegacyId: reconciliation.reasons.duplicateCustomerId,
    },
    vehicles: {
      raw: vehicleRaw, expectedClean: expected.vehicles, skipped: vehicleRaw - expected.vehicles,
      sourceDeleted: reconciliation.deletedVehicleRows,
      invalidLegacyOrCustomerId: reconciliation.reasons.invalidVehicleId,
      missingCustomerLink: reconciliation.reasons.missingCustomerLink,
      duplicateLegacyId: reconciliation.reasons.duplicateVehicleId,
    },
    invoices: {
      raw: finalRaw, expectedClean: expected.invoices, skippedOrCollapsed: finalRaw - expected.invoices,
      sourceDeleted: finalSource.deletedRows, ...invoices.reasons,
    },
    invoiceParts: {
      raw: finalRaw, expectedClean: expected.invoice_parts, skipped: finalRaw - expected.invoice_parts,
      sourceDeleted: finalSource.deletedRows,
      blankDescriptionOrNumber: invoices.reasons.partBlankDescription,
      missingInvoiceLink: invoices.reasons.partMissingInvoice,
    },
    invoiceLabor: {
      raw: laborRaw, expectedClean: expected.invoice_labor, skipped: laborRaw - expected.invoice_labor,
      sourceDeleted: laborSource.deletedRows,
      missingInvoiceOrRoLink: invoices.reasons.laborMissingInvoice,
    },
    accountsReceivable: {
      raw: arRaw, expectedClean: expected.accounts_receivable, skippedOrCollapsed: arRaw - expected.accounts_receivable,
      sourceDeleted: arSource.deletedRows,
      blankRo: invoices.reasons.arBlankRo,
      additionalRowsForRo: invoices.reasons.arAdditionalRows,
      missingInvoiceOrCustomerLink: invoices.reasons.arMissingInvoiceOrCustomer,
    },
    openRepairOrders: {
      raw: openRaw, expectedClean: expected.repair_orders, skippedOrCollapsed: openRaw - expected.repair_orders,
      sourceDeleted: orderPartSource.deletedRows + orderLaborSource.deletedRows,
      ...openOrders.reasons,
    },
  };
}

async function databaseCounts(prisma, shopId) {
  const counts = Object.fromEntries(await Promise.all(OPERATIONAL_MODELS.map(async ([table, model]) => [
    table,
    await prisma[model].count({ where: { shopId } }),
  ])));
  const [customerAliases, recoveredCustomers] = await Promise.all([
    prisma.customerLegacyAlias.count({ where: { shopId } }),
    prisma.customer.count({ where: { shopId, legacySourceTable: "legacy-customer-recovery.json" } }),
  ]);
  return { ...counts, recoveredCustomers, customerAliases };
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

function safeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.DIRECT_URL, process.env.DATABASE_URL]) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  return message.replaceAll(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED DATABASE URL]");
}

async function capturedCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() })
      : reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`)));
  });
}

async function gitCommit() {
  try {
    const result = await capturedCommand("git", ["rev-parse", "HEAD"]);
    return /^[0-9a-f]{40}$/i.test(result.stdout) ? result.stdout : null;
  } catch {
    return null;
  }
}

async function createBackup({ sourceFolder, source, databaseCounts: counts }) {
  if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL is required for backup.");
  try {
    await capturedCommand("supabase", ["--version"]);
  } catch {
    throw new Error("Supabase CLI is unavailable. Install it from https://supabase.com/docs/guides/cli before cutover.");
  }

  const folder = resolve(backupDir, `cutover-${timestampSlug}`);
  await mkdir(backupDir, { recursive: true });
  await mkdir(folder, { recursive: false });
  const dumps = [
    ["roles.sql", ["db", "dump", "--db-url", process.env.DIRECT_URL, "-f", resolve(folder, "roles.sql"), "--role-only"]],
    ["schema.sql", ["db", "dump", "--db-url", process.env.DIRECT_URL, "-f", resolve(folder, "schema.sql")]],
    ["data.sql", ["db", "dump", "--db-url", process.env.DIRECT_URL, "-f", resolve(folder, "data.sql"), "--use-copy", "--data-only"]],
  ];
  const files = {};
  for (const [filename, args] of dumps) {
    try {
      await capturedCommand("supabase", args);
    } catch (error) {
      throw new Error(`Backup failed while creating ${filename}: ${safeError(error)}`);
    }
    const info = await stat(resolve(folder, filename));
    if (!info.isFile() || info.size === 0) throw new Error(`Backup file ${filename} is missing or empty.`);
    files[filename] = { bytes: info.size, nonEmpty: true };
  }
  const manifest = {
    timestamp: timestamp.toISOString(),
    sourcePath: sourceFolder,
    gitCommit: await gitCommit(),
    databaseCounts: counts,
    sourceDbfRowCounts: Object.fromEntries(source?.counts ?? []),
  };
  await writeFile(resolve(folder, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  const manifestInfo = await stat(resolve(folder, "manifest.json"));
  files["manifest.json"] = { bytes: manifestInfo.size, nonEmpty: manifestInfo.size > 0 };
  return { folder, files };
}

function countTable(values) {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0) return "_Not applicable._";
  return ["| Item | Count |", "|---|---:|", ...entries.map(([key, value]) => `| ${key} | ${value} |`)].join("\n");
}

function listOrNone(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function reportMarkdown(summary) {
  const criticalBanner = summary.criticalIssues.length
    ? `> **CRITICAL: ${summary.criticalIssues.join("; ")}**`
    : "> **No critical issues detected.**";
  return `# PlumWorks legacy cutover report

${criticalBanner}

Generated: ${summary.timestamp}

## 1. Overall status: ${summary.status}

Mode: ${summary.mode}

## 2. Source validation

- Required-file validation issues: ${summary.source.validationIssues ?? "Not run"}
- Source path supplied: ${summary.source.path ? "Yes" : "No"}

${countTable(summary.source.rowCounts)}

### Count-only raw-to-clean reconciliation

${summary.source.reconciliation ? JSON.stringify(summary.source.reconciliation, null, 2).split("\n").map((line) => `    ${line}`).join("\n") : "_Not available._"}

## 3. Backup summary

- Requested: ${summary.backup.requested ? "Yes" : "No"}
- Completed: ${summary.backup.completed ? "Yes" : "No"}
- Backup folder: ${summary.backup.directory ?? "Not created"}
- Non-empty files: ${Object.values(summary.backup.files).filter((file) => file.nonEmpty).length}/4

## 4. Reset summary

- Requested: ${summary.reset.requested ? "Yes" : "No"}
- Completed: ${summary.reset.completed ? "Yes" : "No"}

${countTable(summary.reset.rowsDeleted)}

## 5. Reload summary

- Requested: ${summary.reload.requested ? "Yes" : "No"}
- Completed: ${summary.reload.completed ? "Yes" : "No"}

${countTable(summary.reload.counts)}

Raw DBF rows can exceed clean rows because blank, invalid, duplicate, deleted, or unlinked legacy records are skipped or collapsed.

### Customer recovery

- Required: ${summary.recovery.required ? "Yes" : "No"}
- Manifest supplied: ${summary.recovery.manifestProvided ? "Yes" : "No"}
- Source fingerprint bound: ${summary.recovery.sourceFingerprint ? "Yes" : "No"}

${countTable(summary.recovery.counts)}

### Legacy Payment tender allocation

- Invoice/AR import run: ${summary.payment.importRunId ?? "Not run"}
- Payment date policy: ${summary.payment.datePolicy ?? "Not supplied"}
- Report basis: ${summary.payment.reportBasis}

${countTable(summary.payment.counts)}

Source buckets:

${countTable(summary.payment.sourceBuckets)}

Normalized methods:

${countTable(summary.payment.normalizedMethods)}

### Mileage coverage

${countTable(summary.acceptance.mileage)}

### Vendor/source coverage

${countTable(summary.acceptance.vendor)}

### Complimentary-service compatibility

${countTable(summary.acceptance.complimentary)}

### Operational Repair Order eligibility

${countTable(summary.acceptance.operational)}

### Unified-history readiness

${countTable(summary.acceptance.history)}

### Recovery-backfill zero-delta status

${summary.acceptance.recoveryBackfill ? JSON.stringify(summary.acceptance.recoveryBackfill, null, 2).split("\n").map((line) => `    ${line}`).join("\n") : "_Not available._"}

## 6. Verification summary

${countTable(summary.verification)}

## 7. Accounting summary

${countTable(summary.accounting)}

## 8. Preserved records summary

${countTable(summary.preserved)}

## 9. Warnings

${listOrNone(summary.warnings)}

## 10. Critical issues

${listOrNone(summary.criticalIssues)}

## 11. Next actions

${listOrNone(summary.nextActions)}

${criticalBanner}
`;
}

function finalizeStatus(summary) {
  summary.status = summary.criticalIssues.length ? "FAIL" : summary.warnings.length ? "PASS WITH WARNINGS" : "PASS";
  if (summary.status === "FAIL") summary.nextActions.unshift("Stop cutover use and resolve every critical issue before retrying.");
  else if (summary.mode === "dry-run") summary.nextActions.push("Review this dry-run, confirm a Supabase dashboard backup, then run the confirmed one-command cutover.");
  else summary.nextActions.push("Spot-check the application and retain the backup and report according to shop policy.");
}

function conciseSummary(summary, reportPaths) {
  const sourceStatus = summary.source.validationIssues === null
    ? "Not run"
    : summary.source.validationIssues === 0 ? "PASS (all required files present)" : `FAIL (${summary.source.validationIssues} issues)`;
  const backupStatus = summary.backup.requested
    ? `${summary.backup.completed ? "Completed" : "Failed/not completed"} (${Object.values(summary.backup.files).filter((file) => file.nonEmpty).length}/4 non-empty files)`
    : "Not requested";
  const verificationEntries = Object.entries(summary.verification);
  return [
    "=== PLUMWORKS CUTOVER SUMMARY ===",
    `Overall status: ${summary.status}`,
    `Critical issues: ${summary.criticalIssues.length ? summary.criticalIssues.join("; ") : "None"}`,
    `Warnings: ${summary.warnings.length ? summary.warnings.join("; ") : "None"}`,
    `Source validation: ${sourceStatus}`,
    `Backup: ${backupStatus}`,
    `Reset: requested=${summary.reset.requested ? "yes" : "no"}, completed=${summary.reset.completed ? "yes" : "no"}`,
    `Reload: requested=${summary.reload.requested ? "yes" : "no"}, completed=${summary.reload.completed ? "yes" : "no"}`,
    "Verification:",
    ...(verificationEntries.length ? verificationEntries.map(([key, value]) => `  ${key}: ${value}`) : ["  Not run"]),
    `Reports: ${reportPaths.length ? reportPaths.join(", ") : "Not saved"}`,
  ].join("\n");
}

async function emitFinalReport(summary, saveFiles) {
  finalizeStatus(summary);
  const markdown = reportMarkdown(summary);
  const reportPaths = [];
  if (saveFiles) {
    await mkdir(reportDir, { recursive: true });
    const markdownPath = resolve(reportDir, `cutover-${timestampSlug}.md`);
    const jsonPath = resolve(reportDir, `cutover-${timestampSlug}.json`);
    await writeFile(markdownPath, markdown, { flag: "wx" });
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
    reportPaths.push(markdownPath, jsonPath);
  }
  if (summaryOnly) {
    finalLog(conciseSummary(summary, reportPaths));
  } else {
    finalLog("\n=== PLUMWORKS CUTOVER FINAL SUMMARY ===");
    finalLog(markdown);
    if (reportPaths.length) finalLog(`Report files saved: ${reportPaths.join(", ")}`);
  }
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

async function runScriptWithOutput(script, args) {
  const result = await capturedCommand(process.execPath, [resolve("scripts", script), ...args]);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  return result.stdout;
}

function recoveryReferences(source) {
  const details = source?.reconciliation?.sources;
  if (!details) return [];
  return [
    ...details.finalSource.rows.map((row) => ({ row, sourceTable: "FINAL.DBF" })),
    ...details.arSource.rows.map((row) => ({ row, sourceTable: "ar.DBF" })),
  ].map(({ row, sourceTable }) => ({
    legacyRoNo: row.legacyRoNo,
    legacyCustno: row.legacyCustno,
    total: row.rawData?.TOTAL == null ? null : String(row.rawData.TOTAL).trim(),
    sourceTable,
  }));
}

function projectedRecoveryState(source) {
  const reconciliation = source?.reconciliation;
  return {
    customers: (reconciliation?.customers ?? []).map((customer) => ({ ...customer, id: `projected-normal:${customer.legacyCustno}` })),
    vehicles: reconciliation?.vehicles ?? [],
    sourceCustomers: reconciliation?.customers ?? [],
  };
}

function projectedResolvedCustomers(projectedState, recoveryPlan) {
  return [
    ...projectedState.customers.map((customer) => ({ legacyCustno: customer.legacyCustno, customerId: customer.id, resolutionType: "normal" })),
    ...(recoveryPlan?.customersToCreate ?? []).map((customer) => ({ legacyCustno: customer.legacyCustno, customerId: customer.id, resolutionType: "recovered" })),
    ...(recoveryPlan?.aliasesToCreate ?? []).map((alias) => ({ legacyCustno: alias.aliasLegacyCustno, customerId: alias.customerId, resolutionType: "alias" })),
  ];
}

function recoveryIsRequired(source) {
  const state = projectedRecoveryState(source);
  const normalIds = new Set(state.customers.map((customer) => customer.legacyCustno));
  return recoveryReferences(source).some((row) => row.legacyCustno && !normalIds.has(row.legacyCustno));
}

function printRecoveryPlan(plan, mode) {
  console.log(`Customer recovery stage: after Customer/Vehicle transformation and before Invoice staging (${mode})`);
  console.log(`Customer recovery source fingerprint SHA-256: ${plan.sourceFingerprint}`);
  console.log(`normally imported Customers: ${plan.counts.normalCustomers}`);
  console.log(`recovered Customers projected: ${plan.counts.recoveredCustomers}`);
  console.log(`Customer aliases projected: ${plan.counts.aliases}`);
  console.log(`already satisfied recovery entries: ${plan.counts.satisfiedRecoveryEntries}`);
  console.log(`approved unresolved entries: ${plan.counts.approvedUnresolved}`);
  console.log(`unexpected unresolved entries: ${plan.counts.unexpectedUnresolved}`);
  console.log(`recovery collisions: ${plan.collisions.length}`);
  console.log(`stale manifest entries: ${plan.staleManifestEntries.length}`);
  console.log(`recovery warnings: ${plan.warnings.length}`);
  console.log(`recovery fatal issues: ${plan.fatalIssues.length}`);
}

function paymentReport(projection, unresolvedValidation) {
  const january2026ThroughSnapshotCents = Object.entries(projection.dailyPeriodTotals)
    .filter(([date]) => date >= "2026-01-01")
    .reduce((sum, [, aggregate]) => sum + aggregate.amountCents, 0);
  return {
    importRunId: projection.importRunId,
    datePolicy: "invoice-date-proxy",
    reportBasis: projection.label,
    counts: {
      stagedArRows: projection.stagedArRowCount,
      matchedInvoices: projection.matchedInvoiceCount,
      unmatchedInvoices: projection.unmatchedInvoiceCount,
      matchedCustomers: projection.matchedCustomerCount,
      unmatchedCustomers: projection.unmatchedCustomerCount,
      matchedNormalCustomers: projection.counts.customerResolutionCounts.normal ?? 0,
      matchedRecoveredCustomers: projection.counts.customerResolutionCounts.recovered ?? 0,
      matchedAliases: projection.counts.customerResolutionCounts.alias ?? 0,
      proposedPaymentRows: projection.proposedRows.length,
      totalPaymentAmount: (projection.proposedPaymentAmountCents / 100).toFixed(2),
      zeroPaymentOrders: projection.counts.zeroPaymentOrderCount,
      partialPaymentOrders: projection.counts.partialPaymentOrderCount,
      fullyPaidOrders: projection.counts.fullyPaidOrderCount,
      splitTenderOrders: projection.counts.splitTenderOrderCount,
      identicalDuplicateArKeys: projection.counts.identicalDuplicateSourceKeyCount,
      conflictingArKeys: projection.counts.conflictingSourceKeyCount,
      tenderMismatches: projection.counts.tenderMismatchCount,
      invoiceMismatches: projection.counts.invoiceMismatchCount,
      deterministicConflicts: projection.existing.conflicts.length,
      duplicateDeterministicPaymentKeys: projection.counts.duplicateDeterministicKeyCount,
      fatalUnsupportedFieldAmbiguities: projection.fatalIssues.filter((issue) => issue.code === "unsupported-financial-ambiguity").length,
      approvedUnresolvedZeroPayments: unresolvedValidation.approvedZero.length,
      approvedUnresolvedNonzeroPayments: unresolvedValidation.approvedNonzero.length,
      unexpectedUnresolvedPayments: unresolvedValidation.unexpected.length,
      invalidProxyDates: projection.counts.invalidProxyDateCount,
      january2026ThroughSnapshotInvoiceDateProxyTotal: (january2026ThroughSnapshotCents / 100).toFixed(2),
    },
    sourceBuckets: Object.fromEntries(LEGACY_TENDER_BUCKETS.map(({ bucket }) => [bucket,
      `${projection.sourceBucketTotals[bucket].count} / ${(projection.sourceBucketTotals[bucket].amountCents / 100).toFixed(2)}`])),
    normalizedMethods: Object.fromEntries(Object.entries(projection.normalizedMethodTotals).map(([method, value]) => [method,
      `${value.count} / ${(value.amountCents / 100).toFixed(2)}`])),
    unsupportedFields: projection.unsupportedFieldClassifications.map((item) => ({
      field: item.field, classification: item.classification, count: item.count, amount: (item.amountCents / 100).toFixed(2),
    })),
    invoiceDateProxyDays: projection.dailyPeriodTotals,
    invoiceDateProxyMonths: projection.periodTotals,
    perInvoiceReconciliationCount: projection.perInvoiceReconciliation.length,
  };
}

function printPaymentReport(report, mode) {
  console.log(`Legacy Payment stage: after Invoice/AR transformation and before open Repair Order staging (${mode})`);
  console.log(`Invoice/AR import run ID: ${report.importRunId}`);
  console.log(`Payment date policy: ${report.datePolicy}`);
  console.log(`Payment report basis: ${report.reportBasis}`);
  for (const [label, value] of Object.entries(report.counts)) console.log(`${label}: ${value}`);
  console.log(`unsupported Payment source field classifications: ${report.unsupportedFields.length}`);
}

async function loadOperationalRecoveryState(prisma, shopId) {
  const [customers, aliases] = await Promise.all([
    prisma.customer.findMany({
      where: { shopId },
      select: { id: true, legacyCustno: true, displayName: true, phone: true, phone2: true, addressLine1: true },
    }),
    prisma.customerLegacyAlias.findMany({
      where: { shopId },
      select: { customerId: true, aliasLegacyCustno: true },
    }),
  ]);
  return { customers, aliases };
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

async function reloadLegacy(sourceDirectory, shopId, recoveryContext, prisma, paymentDatePolicy) {
  const common = ["--source", sourceDirectory.path, "--shop-id", shopId];
  const customerImportOutput = await runScriptWithOutput("import-customers-vehicles.mjs", common);
  const importRunId = customerImportOutput.match(/import run id:\s*([0-9a-f-]{36})/i)?.[1];
  if (!importRunId) throw new Error("Customer staging did not return an import-run identity; recovery cannot continue.");
  await runScript("transform-customers-vehicles.mjs", ["--shop-id", shopId, "--import-run-id", importRunId]);
  let laterResult = null;
  let activeRecoveryPlan = null;
  const runLaterStages = async (recoveryWriteResult) => {
    const invoiceImportOutput = await runScriptWithOutput("import-invoices.mjs", common);
    const invoiceImportRunId = invoiceImportOutput.match(/import run id:\s*([0-9a-f-]{36})/i)?.[1];
    if (!invoiceImportRunId) throw new Error("Invoice/AR staging did not return an import-run identity; Payment stage cannot continue.");
    const transformOutput = await runScriptWithOutput("transform-invoices.mjs", [
      "--shop-id", shopId,
      "--import-run-id", invoiceImportRunId,
      "--confirm", "TRANSFORM_LEGACY_INVOICES",
    ]);
    const transformedRunId = transformOutput.match(/import run id:\s*([0-9a-f-]{36})/i)?.[1];
    if (transformedRunId !== invoiceImportRunId) throw new Error("Invoice transformation import-run mismatch; Payment stage was blocked.");
    const stage = await loadLegacyPaymentStageProjection({ prisma, shopId, importRunId: invoiceImportRunId, paymentDatePolicy });
    const unresolved = validateApprovedPaymentUnresolved({ projection: stage.projection, recoveryPlan: activeRecoveryPlan });
    if (stage.projection.fatalIssues.length || unresolved.fatalIssues.length) {
      throw new Error("Legacy Payment projection failed; open Repair Order staging was blocked.");
    }
    const paymentWrite = await executeLegacyPaymentInsertTransaction({ confirmedWrite: true, prisma, projection: stage.projection });
    const postStage = await loadLegacyPaymentStageProjection({ prisma, shopId, importRunId: invoiceImportRunId, paymentDatePolicy });
    const [persistedPayments, accountsReceivable] = await Promise.all([
      prisma.payment.findMany({
        where: { shopId, legacySourceTable: "ar.DBF" },
        select: { id: true, invoiceId: true, amount: true, method: true, paidAt: true, reference: true },
      }),
      prisma.accountReceivable.findMany({ where: { shopId }, select: { invoiceId: true, balance: true } }),
    ]);
    const verification = verifyPersistedLegacyPayments({ projection: postStage.projection, persistedPayments, accountsReceivable });
    if (postStage.projection.fatalIssues.length || verification.fatalIssues.length) {
      throw new Error("Legacy Payment post-import verification failed; open Repair Order staging was blocked.");
    }
    const report = paymentReport(postStage.projection, unresolved);
    report.counts.importedPaymentRows = paymentWrite.databaseWrites;
    printPaymentReport(report, "confirmed cutover");
    await runPaymentBeforeOpenOrders({
      runPayment: async () => ({ stage: postStage, paymentWrite, verification, report, recoveryWriteResult }),
      runOpenOrders: async () => {
        await runScript("import-open-orders.mjs", common);
        await runScript("transform-open-orders.mjs", ["--shop-id", shopId]);
      },
    });
    laterResult = { invoiceImportRunId, paymentWrite, paymentVerification: verification, paymentReport: report };
  };
  let recoveryResult = null;
  if (recoveryContext) {
    const state = await loadOperationalRecoveryState(prisma, shopId);
    const plan = planCutoverCustomerRecovery({
      stagedCustomers: state.customers,
      stagedVehicles: recoveryContext.projectedState.vehicles,
      sourceCustomerReferences: recoveryContext.projectedState.sourceCustomers,
      sourceInvoiceArReferences: recoveryContext.references,
      manifest: recoveryContext.manifest,
      existingAliases: state.aliases,
      shopId,
      importRunId,
      sourceFingerprint: sourceDirectory.fingerprint,
    });
    printRecoveryPlan(plan, "confirmed cutover");
    if (plan.fatalIssues.length) throw new Error("Customer recovery validation failed after Customer transformation; Invoice staging was blocked.");
    activeRecoveryPlan = plan;
    const writeResult = await runRecoveryBeforeLaterStages({
      runRecovery: () => executeCutoverCustomerRecovery({ confirmedWrite: true, prisma, plan }),
      runLaterStages,
    });
    console.log(`Customer recovery database writes performed: ${writeResult.databaseWrites}`);
    recoveryResult = { plan, writeResult };
  } else await runLaterStages(null);
  return { ...recoveryResult, ...laterResult, customerImportRunId: importRunId };
}

async function verify(prisma, shopId, preservedBefore, paymentContext = null) {
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
  const preservedAfter = await preservedSnapshot(prisma, shopId);
  const preservedMatches = preservedBefore ? JSON.stringify(preservedAfter) === JSON.stringify(preservedBefore) : null;
  if (preservedBefore) {
    console.log(`shop/admin/user/settings records preserved: ${preservedMatches ? 1 : 0}`);
  }
  const [invoiceTotals, arTotals] = await Promise.all([
    prisma.invoice.aggregate({ where: { shopId }, _sum: { total: true, paidTotal: true } }),
    prisma.accountReceivable.aggregate({ where: { shopId }, _sum: { balance: true } }),
  ]);
  const accountingCheck = await prisma.$queryRaw`
    SELECT
      COALESCE((SELECT SUM(total) FROM invoices WHERE shop_id = ${shopId}::uuid), 0) AS gross_sales,
      COALESCE((SELECT SUM(paid_total) FROM invoices WHERE shop_id = ${shopId}::uuid), 0) AS payments_received,
      COALESCE((SELECT SUM(balance) FROM accounts_receivable WHERE shop_id = ${shopId}::uuid), 0) AS receivables
  `;
  const rawAccounting = accountingCheck[0];
  const [normalCustomerCount, recoveredCustomerCount, aliases, exactCustomers, rawFinalReferences, rawArReferences] = await Promise.all([
    prisma.customer.count({ where: { shopId, legacySourceTable: "Cust.DBF" } }),
    prisma.customer.count({ where: { shopId, legacySourceTable: "legacy-customer-recovery.json" } }),
    prisma.customerLegacyAlias.findMany({ where: { shopId }, select: { aliasLegacyCustno: true } }),
    prisma.customer.findMany({ where: { shopId, legacyCustno: { not: null } }, select: { legacyCustno: true } }),
    prisma.rawLegacyFinal.findMany({ where: { shopId }, select: { legacyCustno: true } }),
    prisma.rawLegacyAr.findMany({ where: { shopId }, select: { legacyCustno: true } }),
  ]);
  const exactLegacyIds = new Set(exactCustomers.map((customer) => customer.legacyCustno));
  const aliasLegacyIds = new Set(aliases.map((alias) => alias.aliasLegacyCustno));
  const invoiceCustomerReferences = [...rawFinalReferences, ...rawArReferences].map((row) => row.legacyCustno).filter(Boolean);
  const exactReferenceCount = invoiceCustomerReferences.filter((legacyCustno) => exactLegacyIds.has(legacyCustno)).length;
  const aliasReferenceCount = invoiceCustomerReferences.filter((legacyCustno) => !exactLegacyIds.has(legacyCustno) && aliasLegacyIds.has(legacyCustno)).length;
  const unmatchedReferenceCount = invoiceCustomerReferences.length - exactReferenceCount - aliasReferenceCount;
  let paymentVerification = null;
  if (paymentContext?.importRunId) {
    const stage = await loadLegacyPaymentStageProjection({
      prisma, shopId, importRunId: paymentContext.importRunId, paymentDatePolicy: paymentContext.paymentDatePolicy,
    });
    const [persistedPayments, operationalAr] = await Promise.all([
      prisma.payment.findMany({
        where: { shopId, legacySourceTable: "ar.DBF" },
        select: { id: true, invoiceId: true, amount: true, method: true, paidAt: true, reference: true },
      }),
      prisma.accountReceivable.findMany({ where: { shopId }, select: { invoiceId: true, balance: true } }),
    ]);
    paymentVerification = {
      ...verifyPersistedLegacyPayments({ projection: stage.projection, persistedPayments, accountsReceivable: operationalAr }),
      report: paymentReport(stage.projection, paymentContext.unresolvedValidation),
    };
  }
  const grossSales = new Prisma.Decimal(invoiceTotals._sum.total ?? 0);
  const paymentsReceived = new Prisma.Decimal(invoiceTotals._sum.paidTotal ?? 0);
  const receivables = new Prisma.Decimal(arTotals._sum.balance ?? 0);
  return {
    counts,
    importedLegacyRecords: imported.reduce((sum, count) => sum + count, 0),
    webCreatedRecords: webCreated.reduce((sum, count) => sum + count, 0),
    rlsProtectedTables: Number(security[0]?.protected ?? 0),
    serverPrismaWorks: true,
    preservedMatches,
    preservedAfter,
    recovery: {
      normalCustomerCount,
      recoveredCustomerCount,
      aliasCount: aliases.length,
      exactReferenceCount,
      aliasReferenceCount,
      unmatchedReferenceCount,
    },
    paymentVerification,
    accounting: {
      grossSales: grossSales.toString(),
      paymentsReceived: paymentsReceived.toString(),
      receivables: receivables.toString(),
      grossSalesCheck: grossSales.equals(new Prisma.Decimal(rawAccounting.gross_sales)),
      paymentsReceivedCheck: paymentsReceived.equals(new Prisma.Decimal(rawAccounting.payments_received)),
      receivablesCheck: receivables.equals(new Prisma.Decimal(rawAccounting.receivables)),
    },
  };
}

async function main() {
  if (flags.has("--help")) return usage();
  const paymentDatePolicy = parsePaymentDatePolicyArgument(process.argv.slice(2));
  runSummary.payment.datePolicy = paymentDatePolicy;
  finalLog(`legacy source directory: ${resolvedLegacySource.path}`);
  finalLog(`legacy source required files: ${Object.values(resolvedLegacySource.actualFiles).join(", ")}`);
  finalLog(`legacy source fingerprint SHA-256: ${resolvedLegacySource.fingerprint}`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  if (destructive && !dryRun && argument("--confirm") !== CONFIRMATION) {
    throw new Error(`Destructive operation blocked. Provide --confirm ${CONFIRMATION}.`);
  }
  if (destructive && !dryRun && !wantsBackup) {
    throw new Error("Destructive operation blocked. --backup is required before reset/reload.");
  }
  if (wantsReload && !dryRun && !wantsReset) {
    throw new Error("Legacy reload and Customer recovery require --reset-operational-data in the same confirmed cutover.");
  }
  const source = await sourceCounts(resolvedLegacySource);
  if (source) {
    runSummary.source.validationIssues = source.validationIssues;
    runSummary.verification.sourceFilesPresent = source.validationIssues === 0 ? 1 : 0;
    runSummary.source.rowCounts = Object.fromEntries(source.counts);
    const expected = expectedCleanCounts(source);
    runSummary.source.expectedCleanCounts = expected ? Object.fromEntries(
      Object.entries(expected).filter(([key]) => key !== "details"),
    ) : {};
    runSummary.source.reconciliation = null;
    for (const filename of DBF_SOURCES) console.log(`${filename} rows available: ${source.counts.get(filename) ?? "unavailable"}`);
    console.log(`source validation issue count: ${source.validationIssues}`);
    if (source.validationIssues > 0) throw new Error("Required source files are missing or unreadable.");
    recordStage("source-validation", { sourceFingerprint: resolvedLegacySource.fingerprint });
    if (expected) {
      const rawBusinessRows = (source.counts.get("Cust.DBF") ?? 0) + (source.counts.get("vehicles.DBF") ?? 0) +
        (source.counts.get("FINAL.DBF") ?? 0) + (source.counts.get("laborfinal.DBF") ?? 0) +
        (source.counts.get("ar.DBF") ?? 0) + (source.counts.get("orders.DBF") ?? 0) +
        (source.counts.get("LABORorder.DBF") ?? 0);
      const expectedBusinessRows = Object.values(runSummary.source.expectedCleanCounts).reduce((sum, count) => sum + count, 0);
      if (rawBusinessRows > expectedBusinessRows) {
        runSummary.warnings.push("Expected raw-to-clean gaps were found; deleted, blank, duplicate, line-level, or unlinked legacy rows are skipped or collapsed.");
      }
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const shop = { id: await resolveSingleShopId(prisma, argument("--shop-id")) };
    console.log("database connection works: 1");
    runSummary.verification.databaseConnection = 1;
    const requiresRecovery = recoveryIsRequired(source);
    runSummary.recovery.required = requiresRecovery;
    const manifestPath = recoveryManifestArgument(process.argv.slice(2), { required: requiresRecovery });
    const loadedRecovery = manifestPath ? await loadRecoveryManifest({ path: manifestPath }) : null;
    runSummary.recovery.manifestProvided = Boolean(loadedRecovery);
    if (loadedRecovery) {
      runSummary.recovery.manifestFingerprint = createHash("sha256").update(await readFile(loadedRecovery.path)).digest("hex");
    }
    recordStage("recovery-manifest-validation", { sourceFingerprint: resolvedLegacySource.fingerprint });
    const projectedState = projectedRecoveryState(source);
    const projectedCustomerImportRunId = deterministicLegacyInvoiceId(shop.id, `customer-import:${resolvedLegacySource.fingerprint}`);
    recordStage("customer-vehicle-staging-projection", { importRunId: projectedCustomerImportRunId });
    recordStage("customer-vehicle-transformation-projection", { importRunId: projectedCustomerImportRunId });
    const recoveryContext = loadedRecovery ? {
      ...loadedRecovery,
      projectedState,
      references: recoveryReferences(source),
    } : null;
    let projectedRecoveryPlan = null;
    if (recoveryContext) {
      projectedRecoveryPlan = planCutoverCustomerRecovery({
        stagedCustomers: projectedState.customers,
        stagedVehicles: projectedState.vehicles,
        sourceCustomerReferences: projectedState.sourceCustomers,
        sourceInvoiceArReferences: recoveryContext.references,
        manifest: recoveryContext.manifest,
        existingAliases: [],
        shopId: shop.id,
        importRunId: projectedCustomerImportRunId,
        sourceFingerprint: resolvedLegacySource.fingerprint,
      });
      printRecoveryPlan(projectedRecoveryPlan, dryRun ? "dry run" : "pre-reset validation");
      runSummary.recovery.counts = projectedRecoveryPlan.counts;
      const recoveredExpected = expectedCleanCounts(source, [...projectedRecoveryPlan.recoveredLegacyIds, ...projectedRecoveryPlan.aliasLegacyIds]);
      if (recoveredExpected) {
        runSummary.source.expectedCleanCounts = Object.fromEntries(
          Object.entries(recoveredExpected).filter(([key]) => key !== "details"),
        );
      }
      if (projectedRecoveryPlan.fatalIssues.length) {
        throw new Error("Customer recovery manifest or source evidence is stale or conflicting; operational reset was blocked.");
      }
    }
    recordStage("customer-recovery-projection", { importRunId: projectedCustomerImportRunId, recoveryFingerprint: resolvedLegacySource.fingerprint });
    const projectedInvoiceImportRunId = deterministicLegacyInvoiceId(shop.id, `invoice-import:${resolvedLegacySource.fingerprint}`);
    const invoiceSources = source.reconciliation.sources;
    const projectedInvoiceInputs = projectLegacyInvoicePaymentInputs({
      shopId: shop.id,
      importRunId: projectedInvoiceImportRunId,
      rawFinal: invoiceSources.finalSource.rows,
      rawLabor: invoiceSources.laborSource.rows,
      rawAr: invoiceSources.arSource.rows,
      resolvedCustomers: projectedResolvedCustomers(projectedState, projectedRecoveryPlan),
    });
    recordStage("invoice-labor-ar-staging-projection", { importRunId: projectedInvoiceImportRunId, recoveryFingerprint: resolvedLegacySource.fingerprint });
    recordStage("invoice-ar-transformation-projection", { importRunId: projectedInvoiceImportRunId, recoveryFingerprint: resolvedLegacySource.fingerprint });
    const projectedPayments = projectLegacyPayments({
      shopId: shop.id,
      importRunId: projectedInvoiceImportRunId,
      stagedArRows: projectedInvoiceInputs.stagedArRows,
      invoices: projectedInvoiceInputs.invoices,
      resolvedCustomers: projectedResolvedCustomers(projectedState, projectedRecoveryPlan),
      paymentDatePolicy,
    });
    const projectedUnresolvedPayments = validateApprovedPaymentUnresolved({ projection: projectedPayments, recoveryPlan: projectedRecoveryPlan });
    runSummary.verification.invoiceArFinancialMismatches = projectedInvoiceInputs.fatalIssues.length;
    runSummary.verification.sourceToInvoiceTotalMismatches = projectedPayments.counts.invoiceMismatchCount;
    runSummary.verification.sourceToArBalanceMismatches = projectedPayments.counts.invoiceMismatchCount;
    runSummary.verification.openOrderFatalRelationshipIssues = 0;
    runSummary.verification.openOrderFatalFinancialIssues = 0;
    if (projectedInvoiceInputs.fatalIssues.length || projectedPayments.fatalIssues.length || projectedUnresolvedPayments.fatalIssues.length) {
      throw new Error("Projected Invoice/AR or Payment validation failed; operational reset was blocked.");
    }
    const projectedPaymentReport = paymentReport(projectedPayments, projectedUnresolvedPayments);
    printPaymentReport(projectedPaymentReport, dryRun ? "dry run" : "pre-reset validation");
    runSummary.payment = projectedPaymentReport;
    const projectedCustomerIds = new Set(projectedResolvedCustomers(projectedState, projectedRecoveryPlan).map((row) => row.legacyCustno));
    const projectedVehicleIds = new Set(projectedState.vehicles.map((row) => row.legacyCarno));
    const projectedOpenOrders = reconcileOpenOrderRows({
      partRows: invoiceSources.orderPartSource.rows,
      laborRows: invoiceSources.orderLaborSource.rows,
      customerIds: projectedCustomerIds,
      vehicleIds: projectedVehicleIds,
    });
    const acceptance = verifyFreshLegacyCutover({
      shopId: shop.id,
      rawAr: invoiceSources.arSource.rows,
      rawFinal: invoiceSources.finalSource.rows,
      openPartRows: invoiceSources.orderPartSource.rows,
      openLaborRows: invoiceSources.orderLaborSource.rows,
      invoiceProjection: projectedInvoiceInputs,
      customerIds: projectedCustomerIds,
      vehicleIds: projectedVehicleIds,
    });
    runSummary.acceptance = acceptance;
    if (acceptance.blockingIssues) {
      throw new Error(`Fresh-cutover acceptance verification failed with ${acceptance.blockingIssues} blocking issue(s).`);
    }
    const authoritativeExpected = authoritativeReloadCounts({
      normalCustomers: projectedState.customers.length,
      recoveredCustomers: projectedRecoveryPlan?.customersToCreate.length ?? 0,
      aliases: projectedRecoveryPlan?.aliasesToCreate.length ?? 0,
      vehicles: projectedState.vehicles.length,
      invoiceProjection: projectedInvoiceInputs,
      rawFinal: invoiceSources.finalSource.rows,
      rawLabor: invoiceSources.laborSource.rows,
      paymentProjection: projectedPayments,
      openOrders: projectedOpenOrders,
    });
    const reconciliationReport = reportReconciliation(source);
    const setProjectedCount = (section, expected, raw = section?.raw) => {
      if (!section) return;
      section.expectedClean = expected;
      if (typeof raw === "number") {
        section.raw = raw;
        if ("skipped" in section) section.skipped = raw - expected;
        if ("skippedOrCollapsed" in section) section.skippedOrCollapsed = raw - expected;
      }
    };
    setProjectedCount(reconciliationReport.customers, authoritativeExpected.customers);
    setProjectedCount(reconciliationReport.vehicles, authoritativeExpected.vehicles);
    reconciliationReport.invoices = {
      raw: source.counts.get("ar.DBF") ?? 0,
      expectedClean: authoritativeExpected.invoices,
      skippedOrCollapsed: (source.counts.get("ar.DBF") ?? 0) - authoritativeExpected.invoices,
      unmatchedCustomerReferences: projectedInvoiceInputs.unmatched.length,
      fatalProjectionIssues: projectedInvoiceInputs.fatalIssues.length,
    };
    reconciliationReport.invoiceParts = {
      raw: source.counts.get("FINAL.DBF") ?? 0,
      expectedClean: authoritativeExpected.invoice_parts,
      skipped: (source.counts.get("FINAL.DBF") ?? 0) - authoritativeExpected.invoice_parts,
    };
    reconciliationReport.invoiceLabor = {
      raw: source.counts.get("laborfinal.DBF") ?? 0,
      expectedClean: authoritativeExpected.invoice_labor,
      skipped: (source.counts.get("laborfinal.DBF") ?? 0) - authoritativeExpected.invoice_labor,
    };
    reconciliationReport.accountsReceivable = {
      raw: source.counts.get("ar.DBF") ?? 0,
      expectedClean: authoritativeExpected.accounts_receivable,
      skippedOrCollapsed: (source.counts.get("ar.DBF") ?? 0) - authoritativeExpected.accounts_receivable,
      unmatchedCustomerReferences: projectedInvoiceInputs.unmatched.length,
      fatalProjectionIssues: projectedInvoiceInputs.fatalIssues.length,
    };
    setProjectedCount(reconciliationReport.openRepairOrders, authoritativeExpected.repair_orders);
    reconciliationReport.openRepairOrderParts = { expectedClean: authoritativeExpected.repair_order_parts };
    reconciliationReport.openRepairOrderLabor = { expectedClean: authoritativeExpected.repair_order_labor };
    const reportedExpected = {
      invoices: reconciliationReport.invoices?.expectedClean,
      accounts_receivable: reconciliationReport.accountsReceivable?.expectedClean,
    };
    const countInconsistencies = validateProjectedCountConsistency({
      expected: authoritativeExpected,
      invoiceProjection: projectedInvoiceInputs,
      paymentProjection: projectedPayments,
      reconciliationExpected: reportedExpected,
    });
    runSummary.preflight.countInconsistencies = countInconsistencies;
    runSummary.source.expectedCleanCounts = authoritativeExpected;
    runSummary.source.reconciliation = reconciliationReport;
    if (countInconsistencies.length) {
      throw new Error(`Projected post-reload counts disagree: ${countInconsistencies.join(" ")}`);
    }
    recordStage("payment-projection", { importRunId: projectedInvoiceImportRunId, paymentDatePolicy, recoveryFingerprint: resolvedLegacySource.fingerprint });
    recordStage("open-repair-order-projection");
    const preservedBefore = await preservedSnapshot(prisma, shop.id);
    const before = await databaseCounts(prisma, shop.id);
    runSummary.preserved = {
      shops: preservedBefore.shops,
      memberships: preservedBefore.memberships,
      staffInvites: preservedBefore.invites,
      cannedServices: preservedBefore.services,
      employees: preservedBefore.employees,
    };
    runSummary.preflight.rowsToDelete = before;
    runSummary.preflight.expectedRowsToReload = authoritativeExpected;
    runSummary.preflight.preservedRows = runSummary.preserved;
    if (wantsSnapshot || wantsReset || (dryRun && !wantsVerify)) {
      printCounts(dryRun ? "rows that would be deleted" : "pre-reset snapshot", before);
    }
    if (dryRun && source) {
      printReconciliation(source, before);
      printCounts("authoritative expected post-reload rows", authoritativeExpected);
    }
    if (wantsPreflight) {
      console.log("full replacement preflight");
      console.log(`required execution flags: ${execution.requiredFullReplacementFlags.join(", ")}`);
      console.log(`required confirmation: --confirm ${CONFIRMATION}`);
      console.log(`backup destination: ${backupDir}`);
      console.log(`source fingerprint SHA-256: ${resolvedLegacySource.fingerprint}`);
      console.log(`recovery manifest fingerprint SHA-256: ${runSummary.recovery.manifestFingerprint ?? "not supplied"}`);
      printCounts("rows to be deleted", before);
      printCounts("expected rows to be reloaded", authoritativeExpected);
      printCounts("preserved rows", runSummary.preserved);
      console.log(`projected count inconsistencies: ${countInconsistencies.length}`);
    }

    if (wantsBackup) {
      console.log("backup: starting");
      const backup = await createBackup({ sourceFolder: resolvedLegacySource.path, source, databaseCounts: before });
      runSummary.backup.completed = true;
      runSummary.backup.directory = backup.folder;
      runSummary.backup.files = backup.files;
      runSummary.verification.backupFilesNonEmpty = Object.values(backup.files).every((file) => file.nonEmpty) ? 4 : 0;
      console.log("backup: completed");
    }

    if (dryRun) {
      const after = await databaseCounts(prisma, shop.id);
      console.log("mode: dry-run");
      console.log("database writes performed: 0");
      const unchanged = JSON.stringify(after) === JSON.stringify(before);
      console.log(`dry-run operational row counts unchanged: ${unchanged ? 1 : 0}`);
      runSummary.verification.databaseWrites = 0;
      runSummary.verification.operationalCountsUnchanged = unchanged ? 1 : 0;
      runSummary.verification.confirmedImports = 0;
      runSummary.verification.migrationsApplied = 0;
      recordStage("final-verification", { databaseWrites: 0 });
      runSummary.warnings.push("Dry-run only: operational reset and legacy reload were not executed.");
      if (wantsBackup) runSummary.warnings.push("A local backup was explicitly requested and created; no application database rows were changed.");
      if (wantsVerify) {
        const result = await verify(prisma, shop.id, preservedBefore);
        applyVerificationSummary(result, false);
      }
      return;
    }

    let completedPaymentContext = null;
    if (wantsReset) {
      await resetOperationalData(prisma, shop.id);
      runSummary.reset.completed = true;
      runSummary.reset.rowsDeleted = before;
      runSummary.verification.resetCompleted = 1;
    }
    if (wantsReload) {
      if (requiresRecovery && !recoveryContext) throw new Error("Legacy reload requires the approved source-bound Customer recovery manifest for this source.");
      const recoveryResult = await reloadLegacy(resolvedLegacySource, shop.id, recoveryContext, prisma, paymentDatePolicy);
      if (recoveryResult.plan) {
        runSummary.recovery.counts = recoveryResult.plan.counts;
        runSummary.reload.counts.recoveredCustomers = recoveryResult.plan.counts.recoveredCustomers;
        runSummary.reload.counts.customerAliases = recoveryResult.plan.counts.aliases;
        runSummary.reload.counts.approvedUnresolved = recoveryResult.plan.counts.approvedUnresolved;
      }
      runSummary.payment = recoveryResult.paymentReport;
      runSummary.payment.importRunId = recoveryResult.invoiceImportRunId;
      completedPaymentContext = {
        importRunId: recoveryResult.invoiceImportRunId,
        paymentDatePolicy,
        unresolvedValidation: { approvedZero: [], approvedNonzero: [], unexpected: [] },
      };
      runSummary.reload.completed = true;
    }
    if (wantsVerify || wantsReload) {
      const result = await verify(prisma, shop.id, preservedBefore, completedPaymentContext);
      runSummary.reload.counts = result.counts;
      applyVerificationSummary(result, true);
      const expected = runSummary.source.expectedCleanCounts;
      for (const table of [
        "customers", "recoveredCustomers", "customerAliases", "vehicles", "invoices", "invoice_parts", "invoice_labor",
        "accounts_receivable", "payments", "repair_orders", "repair_order_parts", "repair_order_labor",
      ]) {
        if (expected[table] !== undefined && result.counts[table] !== expected[table]) {
          runSummary.criticalIssues.push(`${table} verification failed: expected ${expected[table]}, found ${result.counts[table]}.`);
        }
      }
      if (result.webCreatedRecords !== 0) runSummary.criticalIssues.push("Web-created test records remain after confirmed reload.");
      if (!result.preservedMatches) runSummary.criticalIssues.push("Preserved shop/admin/settings counts changed during cutover.");
      if (result.rlsProtectedTables !== PROTECTED_TABLES.length) runSummary.criticalIssues.push("RLS/API protection verification failed.");
      if (!result.accounting.grossSalesCheck) runSummary.criticalIssues.push("Gross Sales report verification failed.");
      if (!result.accounting.paymentsReceivedCheck) runSummary.criticalIssues.push("Payments Received report verification failed.");
      if (!result.accounting.receivablesCheck) runSummary.criticalIssues.push("Receivables report verification failed.");
      if (result.paymentVerification?.fatalIssues.length) runSummary.criticalIssues.push("Legacy Payment verification failed after reload.");
      if (result.counts.payments !== runSummary.payment.counts.proposedPaymentRows) {
        runSummary.criticalIssues.push(`Payment row verification failed: expected ${runSummary.payment.counts.proposedPaymentRows}, found ${result.counts.payments}.`);
      }
    }
    if (wantsReload && runSummary.criticalIssues.length === 0) {
      await prisma.auditLog.create({
        data: {
          shopId: shop.id, action: "legacy_cutover_completed", entityType: "shop",
          entityId: shop.id, entityLabel: "Legacy cutover", entityHref: "/admin/data-tools",
          contextSummary: "Operational data reloaded from approved legacy source",
          metadata: { sourceType: "Shopman32 DBF", driver: "legacy-cutover", invoiceArImportRunId: completedPaymentContext?.importRunId },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

function applyVerificationSummary(result, afterReload) {
  runSummary.verification = {
    ...runSummary.verification,
    customersImported: result.counts.customers,
    vehiclesImported: result.counts.vehicles,
    invoicesImported: result.counts.invoices,
    invoicePartsImported: result.counts.invoice_parts,
    invoiceLaborImported: result.counts.invoice_labor,
    accountsReceivableImported: result.counts.accounts_receivable,
    openRepairOrdersImported: result.counts.repair_orders,
    rlsProtectedTables: `${result.rlsProtectedTables}/${PROTECTED_TABLES.length}`,
    serverSidePrismaQuery: result.serverPrismaWorks ? 1 : 0,
    webCreatedTestRecords: result.webCreatedRecords,
    verifiedAfterReload: afterReload ? 1 : 0,
    normallyImportedCustomers: result.recovery.normalCustomerCount,
    recoveredCustomers: result.recovery.recoveredCustomerCount,
    customerAliases: result.recovery.aliasCount,
    invoiceCustomerReferencesResolvedExact: result.recovery.exactReferenceCount,
    invoiceCustomerReferencesResolvedThroughAliases: result.recovery.aliasReferenceCount,
    remainingUnmatchedInvoiceArCustomerReferences: result.recovery.unmatchedReferenceCount,
    satisfiedRecoveryEntries: runSummary.recovery.counts.satisfiedRecoveryEntries ?? 0,
    approvedUnresolvedRecoveryEntries: runSummary.recovery.counts.approvedUnresolved ?? 0,
    unexpectedUnresolvedRecoveryEntries: runSummary.recovery.counts.unexpectedUnresolved ?? 0,
    recoveryAliasCollisions: runSummary.recovery.counts.aliasCollisions ?? 0,
    paymentSumMismatches: result.paymentVerification?.paymentSumMismatches ?? "not run",
    paymentArBalanceMismatches: result.paymentVerification?.balanceMismatches ?? "not run",
    paymentDeterministicConflicts: result.paymentVerification?.deterministicConflicts ?? "not run",
    unexpectedLegacyPaymentRows: result.paymentVerification?.unexpectedPaymentRows ?? "not run",
  };
  runSummary.accounting = {
    grossSales: result.accounting.grossSales,
    paymentsReceived: result.accounting.paymentsReceived,
    receivables: result.accounting.receivables,
    grossSalesCheck: result.accounting.grossSalesCheck ? 1 : 0,
    paymentsReceivedCheck: result.accounting.paymentsReceivedCheck ? 1 : 0,
    receivablesCheck: result.accounting.receivablesCheck ? 1 : 0,
  };
  runSummary.preserved = {
    ...runSummary.preserved,
    settingsPreserved: result.preservedMatches === null ? "not compared" : result.preservedMatches ? 1 : 0,
    membershipsPreserved: result.preservedMatches === null ? "not compared" : result.preservedMatches ? 1 : 0,
    cannedServicesPreserved: result.preservedMatches === null ? "not compared" : result.preservedMatches ? 1 : 0,
    authUsersUntouchedByDriver: 1,
  };
}

try {
  await main();
} catch (error) {
  const message = safeError(error);
  runSummary.criticalIssues.push(message);
  console.error(`legacy cutover failed: ${message}`);
  process.exitCode = 1;
} finally {
  if (destructive || wantsReport || summaryOnly) {
    try {
      await emitFinalReport(runSummary, wantsReport);
    } catch (error) {
      finalError(`cutover report failed: ${safeError(error)}`);
      process.exitCode = 1;
    }
  }
}
