import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  groupRowsByRo,
  selectLegacyInvoiceDate,
} from "./lib/legacy-invoice-reconciliation.mjs";
import {
  centsToDecimal,
  mapLegacyInvoiceFinancials,
} from "./lib/legacy-invoice-financials.mjs";
import {
  customerCreateData,
  isMissingAliasTableError,
  manifestOrderSummary,
  planAliasRecovery,
  planCustomerRecovery,
} from "./lib/legacy-customer-recovery.mjs";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

const execFileAsync = promisify(execFile);
const CONFIRMATION = "RECOVER_LEGACY_CUSTOMERS";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  throw new Error(`Legacy customer recovery failed: ${message}`);
}

async function loadAliases(client, shopId, allowMissingTable) {
  try {
    return await client.customerLegacyAlias.findMany({
      where: { shopId },
      select: { id: true, shopId: true, customerId: true, aliasLegacyCustno: true, source: true, notes: true },
    });
  } catch (error) {
    if (allowMissingTable && isMissingAliasTableError(error)) return [];
    throw error;
  }
}

async function loadRecoveryState(client, shopId, allowMissingAliasTable) {
  const customers = await client.customer.findMany({
    where: { shopId },
    select: { id: true, legacyCustno: true, displayName: true, phone: true, phone2: true, addressLine1: true },
  });
  const aliases = await loadAliases(client, shopId, allowMissingAliasTable);
  return { customers, aliases };
}

function makePlan(manifest, state) {
  const aliasPlan = planAliasRecovery(manifest.existingCustomerAliases, state.customers, state.aliases);
  const customerPlan = planCustomerRecovery(manifest.customersToCreate, state.customers, state.aliases);
  return { aliasPlan, customerPlan };
}

function assertNoConflicts(plan) {
  const messages = [
    ...plan.aliasPlan.conflicts.map(({ entry, reason }) => `alias ${entry.legacyCustomerId}: ${reason}`),
    ...plan.customerPlan.conflicts.map(({ entry, reason }) => `customer ${entry.legacyCustomerId}: ${reason}`),
  ];
  if (messages.length) fail(`conflicts prevent recovery:\n${messages.join("\n")}`);
}

async function financialImpact(prisma, shopId, orderNumbers) {
  const latest = await prisma.legacyImportRun.findFirst({
    where: { shopId, OR: [{ rawFinal: { some: {} } }, { rawLaborFinal: { some: {} } }, { rawAr: { some: {} } }] },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) fail("no staged invoice import run was found.");
  const [rawAr, rawFinal, rawLabor] = await Promise.all([
    prisma.rawLegacyAr.findMany({ where: { shopId, legacyImportRunId: latest.id, legacyRoNo: { in: orderNumbers } }, select: { legacyRoNo: true, rawData: true } }),
    prisma.rawLegacyFinal.findMany({ where: { shopId, legacyImportRunId: latest.id, legacyRoNo: { in: orderNumbers } }, select: { legacyRoNo: true, rawData: true } }),
    prisma.rawLegacyLaborFinal.findMany({ where: { shopId, legacyImportRunId: latest.id, legacyRoNo: { in: orderNumbers } }, select: { legacyRoNo: true, rawData: true } }),
  ]);
  const arGroups = groupRowsByRo(rawAr);
  const finalGroups = groupRowsByRo(rawFinal);
  const laborGroups = groupRowsByRo(rawLabor);
  const totals = { before2025: 0, calendar2025: 0, januaryToJune2026: 0, all: 0 };
  for (const orderNumber of orderNumbers) {
    const arRows = arGroups.get(orderNumber) ?? [];
    if (!arRows.length) fail(`RO ${orderNumber} is missing from raw AR staging.`);
    const date = selectLegacyInvoiceDate({ arRows, finalRows: finalGroups.get(orderNumber) ?? [], laborRows: laborGroups.get(orderNumber) ?? [] }).date;
    if (!date) fail(`RO ${orderNumber} has no valid selected invoice date.`);
    const financials = mapLegacyInvoiceFinancials(arRows[0].rawData);
    if (!financials.valid || !financials.reconciliation.reconciles) fail(`RO ${orderNumber} financials do not reconcile.`);
    totals.all += financials.totalCents;
    const time = date.getTime();
    if (time < Date.UTC(2025, 0, 1)) totals.before2025 += financials.totalCents;
    if (time >= Date.UTC(2025, 0, 1) && time < Date.UTC(2026, 0, 1)) totals.calendar2025 += financials.totalCents;
    if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 6, 1)) totals.januaryToJune2026 += financials.totalCents;
  }
  return totals;
}

const fileArgument = argument("--file");
if (!fileArgument) fail("--file <manifest path> is required.");
const confirmation = argument("--confirm");
if (confirmation !== undefined && confirmation !== CONFIRMATION) fail(`--confirm must equal ${CONFIRMATION}.`);
const dryRun = process.argv.includes("--dry-run") || confirmation !== CONFIRMATION;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is not configured.");
const manifestPath = resolve(process.cwd(), fileArgument);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!dryRun) {
  const unapproved = [...manifest.existingCustomerAliases, ...manifest.customersToCreate]
    .filter((entry) => entry.reviewStatus !== "approved");
  if (unapproved.length) fail(`${unapproved.length} recoverable manifest entries are not approved.`);
}

try {
  await execFileAsync(process.execPath, [resolve(process.cwd(), "scripts/validate-legacy-customer-recovery.mjs"), "--file", manifestPath], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
} catch (error) {
  fail(`shared manifest validator rejected the recovery:\n${error.stderr || error.stdout || error.message}`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const shopId = await resolveSingleShopId(prisma);
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { id: true, name: true } });
  const summary = manifestOrderSummary(manifest);
  const impact = await financialImpact(prisma, shopId, summary.recoverableOrders);
  const state = await loadRecoveryState(prisma, shopId, dryRun);
  const plan = makePlan(manifest, state);
  assertNoConflicts(plan);

  let writes = 0;
  if (!dryRun) {
    writes = await prisma.$transaction(async (transaction) => {
      const transactionalState = await loadRecoveryState(transaction, shopId, false);
      const transactionalPlan = makePlan(manifest, transactionalState);
      assertNoConflicts(transactionalPlan);
      for (const entry of transactionalPlan.aliasPlan.inserts) {
        await transaction.customerLegacyAlias.create({
          data: { shopId, customerId: entry.existingCustomerId, aliasLegacyCustno: entry.legacyCustomerId, source: "legacy-customer-recovery.json", notes: entry.notes },
        });
      }
      for (const entry of transactionalPlan.customerPlan.inserts) {
        await transaction.customer.create({ data: customerCreateData(entry, shopId) });
      }
      return transactionalPlan.aliasPlan.inserts.length + transactionalPlan.customerPlan.inserts.length;
    }, { timeout: 120_000 });
  }

  console.log(`target shop: ${shop.name} (${shop.id})`);
  console.log(`manifest version: ${manifest.manifestVersion}`);
  console.log(`mode: ${dryRun ? "dry-run" : "confirmed"}`);
  console.log(`alias entries reviewed: ${manifest.existingCustomerAliases.length}`);
  console.log(`alias rows to insert: ${plan.aliasPlan.inserts.length}`);
  console.log(`alias rows unchanged: ${plan.aliasPlan.unchanged.length}`);
  console.log(`alias conflicts: ${plan.aliasPlan.conflicts.length}`);
  console.log(`customers to insert: ${plan.customerPlan.inserts.length}`);
  console.log(`customers unchanged: ${plan.customerPlan.unchanged.length}`);
  console.log(`customer conflicts: ${plan.customerPlan.conflicts.length}`);
  console.log(`orders recoverable through aliases: ${summary.aliasOrders.length}`);
  console.log(`orders recoverable through customer creation: ${summary.creationOrders.length}`);
  console.log(`recoverable orders: ${summary.recoverableOrders.length}`);
  console.log(`unresolved orders: ${summary.unresolvedOrders.length}`);
  console.log(`before 2025 gross sales: ${centsToDecimal(impact.before2025)}`);
  console.log(`calendar 2025 impact: ${centsToDecimal(impact.calendar2025)}`);
  console.log(`January-June 2026 impact: ${centsToDecimal(impact.januaryToJune2026)}`);
  console.log(`recoverable gross sales: ${centsToDecimal(impact.all)}`);
  console.log(`database writes performed: ${writes}`);
} finally {
  await prisma.$disconnect();
}
