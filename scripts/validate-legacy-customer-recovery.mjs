import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import { resolveSingleShopId } from "./lib/single-shop.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  throw new Error(`Legacy customer recovery manifest validation failed: ${message}`);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function requireObject(value, label) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
}

function requireString(value, label, { allowBlank = false } = {}) {
  requireCondition(typeof value === "string", `${label} must be a string.`);
  if (!allowBlank) requireCondition(value.trim().length > 0, `${label} must not be blank.`);
}

function requireStringArray(value, label) {
  requireCondition(Array.isArray(value), `${label} must be an array.`);
  value.forEach((item, index) => requireString(item, `${label}[${index}]`));
  requireCondition(new Set(value).size === value.length, `${label} must not contain duplicates.`);
}

function words(value) {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim() ?? "";
}

function fullPhone(value) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

function validateStructure(manifest) {
  requireObject(manifest, "manifest");
  requireString(manifest.manifestVersion, "manifestVersion");
  requireCondition(manifest.manifestVersion === "1.0.0", "manifestVersion must be 1.0.0.");
  requireString(manifest.clientSlug, "clientSlug");
  requireCondition(manifest.clientSlug === "cardoc", "clientSlug must be cardoc.");
  requireString(manifest.generatedAt, "generatedAt");
  requireCondition(Number.isFinite(Date.parse(manifest.generatedAt)), "generatedAt must be an ISO date-time.");
  requireString(manifest.sourceDescription, "sourceDescription");
  requireCondition(Array.isArray(manifest.existingCustomerAliases), "existingCustomerAliases must be an array.");
  requireCondition(Array.isArray(manifest.customersToCreate), "customersToCreate must be an array.");
  requireCondition(Array.isArray(manifest.unresolvedOrders), "unresolvedOrders must be an array.");
  requireCondition(manifest.existingCustomerAliases.length === 6, "exactly 6 alias entries are required.");
  requireCondition(manifest.customersToCreate.length === 12, "exactly 12 customer creation entries are required.");
  requireCondition(manifest.unresolvedOrders.length === 1, "exactly 1 unresolved order is required.");

  for (const [index, alias] of manifest.existingCustomerAliases.entries()) {
    const label = `existingCustomerAliases[${index}]`;
    requireObject(alias, label);
    for (const field of ["legacyCustomerId", "existingCustomerId", "existingCustomerLegacyId", "normalizedName", "normalizedAddress", "matchingMethod", "confidence", "reviewStatus", "notes"]) requireString(alias[field], `${label}.${field}`);
    requireCondition(alias.matchingMethod === "exact-normalized-name-address", `${label}.matchingMethod is invalid.`);
    requireCondition(alias.confidence === "deterministic", `${label}.confidence must be deterministic.`);
    requireCondition(alias.reviewStatus === "pending", `${label}.reviewStatus must be pending.`);
    requireStringArray(alias.applicableLegacyOrderNumbers, `${label}.applicableLegacyOrderNumbers`);
  }

  for (const [index, customer] of manifest.customersToCreate.entries()) {
    const label = `customersToCreate[${index}]`;
    requireObject(customer, label);
    for (const field of ["legacyCustomerId", "displayName", "classification", "reviewStatus", "notes"]) requireString(customer[field], `${label}.${field}`);
    for (const field of ["phone", "alternatePhone", "address", "city", "state", "postalCode"]) requireCondition(customer[field] === null || typeof customer[field] === "string", `${label}.${field} must be a string or null.`);
    requireCondition(["normal-historical", "historical-unknown"].includes(customer.classification), `${label}.classification is invalid.`);
    requireCondition(customer.reviewStatus === "pending", `${label}.reviewStatus must be pending.`);
    requireStringArray(customer.associatedLegacyVehicleIds, `${label}.associatedLegacyVehicleIds`);
    requireStringArray(customer.applicableLegacyOrderNumbers, `${label}.applicableLegacyOrderNumbers`);
    requireObject(customer.sourceEvidence, `${label}.sourceEvidence`);
  }

  const unresolved = manifest.unresolvedOrders[0];
  requireObject(unresolved, "unresolvedOrders[0]");
  for (const field of ["legacyOrderNumber", "legacyCustomerId", "total", "reason", "disposition", "reviewStatus"]) requireString(unresolved[field], `unresolvedOrders[0].${field}`);
  requireCondition(unresolved.legacyOrderNumber === "18181", "RO 18181 must be the only unresolved order.");
  requireCondition(unresolved.legacyCustomerId === "87604740", "RO 18181 must use customer 87604740.");
  requireCondition(unresolved.total === "0.00", "RO 18181 total must be 0.00.");
  requireCondition(unresolved.disposition === "keep-skipped", "RO 18181 disposition must be keep-skipped.");
  requireCondition(unresolved.reviewStatus === "approved-skip", "RO 18181 reviewStatus must be approved-skip.");

  const legacyIds = [...manifest.existingCustomerAliases, ...manifest.customersToCreate].map((entry) => entry.legacyCustomerId);
  requireCondition(new Set(legacyIds).size === legacyIds.length, "legacy customer IDs must be unique across alias and creation entries.");
  const recoverableOrders = [...manifest.existingCustomerAliases, ...manifest.customersToCreate].flatMap((entry) => entry.applicableLegacyOrderNumbers);
  requireCondition(recoverableOrders.length === 65, "manifest must account for exactly 65 recoverable orders.");
  requireCondition(new Set(recoverableOrders).size === 65, "recoverable order numbers must be unique.");
  requireCondition(!recoverableOrders.includes("18181"), "RO 18181 must not be recoverable.");
  return recoverableOrders;
}

const fileArgument = argument("--file");
if (!fileArgument) fail("--file <manifest path> is required.");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is not configured.");

const manifestPath = resolve(process.cwd(), fileArgument);
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  fail(`could not read valid JSON from ${manifestPath}: ${error.message}`);
}
const recoverableOrders = validateStructure(manifest);
const allOrderNumbers = [...recoverableOrders, "18181"];
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const shopId = await resolveSingleShopId(prisma);
  const latest = await prisma.legacyImportRun.findFirst({
    where: { shopId, OR: [{ rawFinal: { some: {} } }, { rawLaborFinal: { some: {} } }, { rawAr: { some: {} } }] },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  requireCondition(latest, "no staged invoice import run was found.");

  const [customers, rawAr, rawFinal, rawLabor] = await Promise.all([
    prisma.customer.findMany({
      where: { shopId },
      select: { id: true, legacyCustno: true, displayName: true, phone: true, phone2: true, addressLine1: true },
    }),
    prisma.rawLegacyAr.findMany({
      where: { shopId, legacyImportRunId: latest.id, legacyRoNo: { in: allOrderNumbers } },
      select: { legacyRoNo: true, legacyCustno: true, legacyCarno: true, rawData: true },
    }),
    prisma.rawLegacyFinal.findMany({
      where: { shopId, legacyImportRunId: latest.id, legacyRoNo: { in: allOrderNumbers } },
      select: { legacyRoNo: true, legacyCustno: true, legacyCarno: true, rawData: true },
    }),
    prisma.rawLegacyLaborFinal.findMany({
      where: { shopId, legacyImportRunId: latest.id, legacyRoNo: { in: allOrderNumbers } },
      select: { legacyRoNo: true, legacyCustno: true, legacyCarno: true, rawData: true },
    }),
  ]);

  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  for (const alias of manifest.existingCustomerAliases) {
    const customer = customersById.get(alias.existingCustomerId);
    requireCondition(customer, `alias ${alias.legacyCustomerId} existing customer ${alias.existingCustomerId} does not exist.`);
    requireCondition(customer.legacyCustno === alias.existingCustomerLegacyId, `alias ${alias.legacyCustomerId} existing legacy ID changed.`);
    requireCondition(words(customer.displayName) === alias.normalizedName, `alias ${alias.legacyCustomerId} normalized name no longer matches.`);
    requireCondition(words(customer.addressLine1) === alias.normalizedAddress, `alias ${alias.legacyCustomerId} normalized address no longer matches.`);
    const matches = customers.filter((candidate) => words(candidate.displayName) === alias.normalizedName && words(candidate.addressLine1) === alias.normalizedAddress);
    requireCondition(matches.length === 1 && matches[0].id === customer.id, `alias ${alias.legacyCustomerId} normalized name/address evidence is no longer unique.`);
    requireCondition(customer.legacyCustno !== alias.legacyCustomerId, `alias ${alias.legacyCustomerId} must not overwrite an existing current legacy ID.`);
  }

  for (const candidate of manifest.customersToCreate) {
    const legacyMatches = customers.filter((customer) => customer.legacyCustno === candidate.legacyCustomerId);
    requireCondition(legacyMatches.length === 0, `creation candidate ${candidate.legacyCustomerId} already exists operationally.`);
    if (candidate.classification === "normal-historical" && words(candidate.displayName) && words(candidate.address)) {
      const matches = customers.filter((customer) => words(customer.displayName) === words(candidate.displayName) && words(customer.addressLine1) === words(candidate.address));
      requireCondition(matches.length === 0, `creation candidate ${candidate.legacyCustomerId} collides on exact normalized name/address.`);
    }
    const candidatePhones = [candidate.phone, candidate.alternatePhone].map(fullPhone).filter(Boolean);
    for (const phone of candidatePhones) {
      const matches = customers.filter((customer) => [customer.phone, customer.phone2].map(fullPhone).includes(phone));
      requireCondition(matches.length === 0, `creation candidate ${candidate.legacyCustomerId} collides on exact full phone ${phone}.`);
    }
  }

  const arGroups = groupRowsByRo(rawAr);
  const finalGroups = groupRowsByRo(rawFinal);
  const laborGroups = groupRowsByRo(rawLabor);
  requireCondition(arGroups.size === 66, `expected 66 raw AR order groups, found ${arGroups.size}.`);
  let before2025 = 0;
  let calendar2025 = 0;
  let januaryToJune2026 = 0;
  let totalCents = 0;
  for (const entry of [...manifest.existingCustomerAliases, ...manifest.customersToCreate]) {
    for (const orderNumber of entry.applicableLegacyOrderNumbers) {
      const rows = arGroups.get(orderNumber) ?? [];
      requireCondition(rows.length > 0, `RO ${orderNumber} is missing from raw AR staging.`);
      requireCondition(rows.every((row) => row.legacyCustno === entry.legacyCustomerId), `RO ${orderNumber} AR customer ID does not match ${entry.legacyCustomerId}.`);
    }
  }
  const unresolvedRows = arGroups.get("18181") ?? [];
  requireCondition(unresolvedRows.length > 0 && unresolvedRows.every((row) => row.legacyCustno === "87604740"), "RO 18181 raw AR evidence changed.");

  for (const orderNumber of allOrderNumbers) {
    const arRows = arGroups.get(orderNumber) ?? [];
    const selected = selectLegacyInvoiceDate({ arRows, finalRows: finalGroups.get(orderNumber) ?? [], laborRows: laborGroups.get(orderNumber) ?? [] });
    requireCondition(selected.date, `RO ${orderNumber} has no valid selected invoice date.`);
    const time = selected.date.getTime();
    if (time < Date.UTC(2025, 0, 1)) before2025 += 1;
    if (time >= Date.UTC(2025, 0, 1) && time < Date.UTC(2026, 0, 1)) calendar2025 += 1;
    if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 6, 1)) januaryToJune2026 += 1;
    const financials = mapLegacyInvoiceFinancials(arRows[0].rawData);
    requireCondition(financials.valid && financials.reconciliation.reconciles, `RO ${orderNumber} financials no longer reconcile.`);
    totalCents += financials.totalCents;
  }
  requireCondition(before2025 === 66, `expected all 66 orders before 2025, found ${before2025}.`);
  requireCondition(calendar2025 === 0, "one or more recovery orders affect calendar 2025.");
  requireCondition(januaryToJune2026 === 0, "one or more recovery orders affect January-June 2026.");
  requireCondition(totalCents === 2_271_869, `expected total 22718.69, found ${centsToDecimal(totalCents)}.`);
  const unresolvedFinancials = mapLegacyInvoiceFinancials(unresolvedRows[0].rawData);
  requireCondition(unresolvedFinancials.totalCents === 0, "RO 18181 is no longer zero-dollar.");

  console.log(`manifest: ${manifestPath}`);
  console.log("validation mode: read-only");
  console.log(`alias entries: ${manifest.existingCustomerAliases.length}`);
  console.log(`customer creation entries: ${manifest.customersToCreate.length}`);
  console.log(`recoverable orders: ${recoverableOrders.length}`);
  console.log(`unresolved orders: ${manifest.unresolvedOrders.length}`);
  console.log(`orders before 2025: ${before2025}`);
  console.log(`calendar 2025 orders: ${calendar2025}`);
  console.log(`January-June 2026 orders: ${januaryToJune2026}`);
  console.log(`gross historical total: ${centsToDecimal(totalCents)}`);
  console.log("alias uniqueness checks: passed");
  console.log("creation collision checks: passed");
  console.log("raw AR customer/order checks: passed");
  console.log("legacy customer recovery manifest validation: passed");
} finally {
  await prisma.$disconnect();
}
