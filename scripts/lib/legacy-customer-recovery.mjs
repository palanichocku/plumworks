import { createHash } from "node:crypto";
import { parseLegacyMoneyCents } from "./legacy-invoice-financials.mjs";

export const CUTOVER_RECOVERY_FORMAT_VERSION = "2.0.0";
export const CUTOVER_RECOVERY_SOURCE_TABLES = Object.freeze([
  "Cust.DBF", "vehicles.DBF", "FINAL.DBF", "laborfinal.DBF", "ar.DBF",
]);
export const RECOVERED_CUSTOMER_UUID_NAMESPACE = "24ab619b-852f-4e4a-bb24-af36567c553c";
export const APPROVED_SEED_RECOVERY_AGGREGATE = Object.freeze({
  matchedInvoicesAfterRecovery: 11_665,
  unresolvedInvoiceSourceRows: 1,
  matchedCustomersForPaymentProjection: 11_665,
  unresolvedCustomersForPaymentProjection: 1,
});

export function normalizedWords(value) {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim() ?? "";
}

export function normalizedFullPhone(value) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

export function resolveLegacyCustomerId(legacyCustno, exactCustomerIds, aliasCustomerIds) {
  if (!legacyCustno) return null;
  const exact = exactCustomerIds.get(legacyCustno) ?? null;
  const alias = aliasCustomerIds.get(legacyCustno) ?? null;
  if (exact && alias && exact !== alias) {
    throw new Error(`Legacy customer ID ${legacyCustno} resolves to exact customer ${exact} and conflicting alias customer ${alias}.`);
  }
  return exact ?? alias;
}

export function aliasResolutionMaps(customers, aliases) {
  const exactCustomerIds = new Map();
  for (const customer of customers) {
    if (customer.legacyCustno) exactCustomerIds.set(customer.legacyCustno, customer.id);
  }
  const aliasCustomerIds = new Map();
  for (const alias of aliases) {
    const current = aliasCustomerIds.get(alias.aliasLegacyCustno);
    if (current && current !== alias.customerId) {
      throw new Error(`Alias ${alias.aliasLegacyCustno} is assigned to multiple customers.`);
    }
    aliasCustomerIds.set(alias.aliasLegacyCustno, alias.customerId);
  }
  for (const [legacyCustno, exactCustomerId] of exactCustomerIds) {
    const aliasCustomerId = aliasCustomerIds.get(legacyCustno);
    if (aliasCustomerId && aliasCustomerId !== exactCustomerId) {
      throw new Error(`Legacy customer ID ${legacyCustno} has conflicting exact and alias customers.`);
    }
  }
  return { exactCustomerIds, aliasCustomerIds };
}

export function planAliasRecovery(entries, customers, aliases) {
  const inserts = [];
  const unchanged = [];
  const conflicts = [];
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const exactByLegacy = new Map(customers.filter((customer) => customer.legacyCustno).map((customer) => [customer.legacyCustno, customer]));
  const aliasByLegacy = new Map(aliases.map((alias) => [alias.aliasLegacyCustno, alias]));

  for (const entry of entries) {
    const target = customersById.get(entry.existingCustomerId);
    const exactOwner = exactByLegacy.get(entry.legacyCustomerId);
    const existingAlias = aliasByLegacy.get(entry.legacyCustomerId);
    const evidenceMatches = customers.filter((customer) =>
      normalizedWords(customer.displayName) === entry.normalizedName &&
      normalizedWords(customer.addressLine1) === entry.normalizedAddress
    );
    let reason = null;
    if (!target) reason = "target customer does not exist";
    else if (target.legacyCustno !== entry.existingCustomerLegacyId) reason = "target current legacy customer ID changed";
    else if (evidenceMatches.length !== 1 || evidenceMatches[0].id !== target.id) reason = "normalized name/address evidence is not unique";
    else if (exactOwner && exactOwner.id !== target.id) reason = `alias legacy ID is already the exact ID of customer ${exactOwner.id}`;
    else if (existingAlias && existingAlias.customerId !== target.id) reason = `alias is already assigned to customer ${existingAlias.customerId}`;
    if (reason) conflicts.push({ entry, reason });
    else if (existingAlias) unchanged.push({ entry, alias: existingAlias });
    else inserts.push(entry);
  }
  return { inserts, unchanged, conflicts };
}

export function planCustomerRecovery(entries, customers, aliases) {
  const inserts = [];
  const unchanged = [];
  const conflicts = [];
  const exactByLegacy = new Map(customers.filter((customer) => customer.legacyCustno).map((customer) => [customer.legacyCustno, customer]));
  const aliasByLegacy = new Map(aliases.map((alias) => [alias.aliasLegacyCustno, alias]));

  for (const entry of entries) {
    const existing = exactByLegacy.get(entry.legacyCustomerId);
    const existingAlias = aliasByLegacy.get(entry.legacyCustomerId);
    let reason = null;
    if (existingAlias && existingAlias.customerId !== existing?.id) reason = `legacy ID is already assigned as an alias to customer ${existingAlias.customerId}`;
    if (existing) {
      if (existing.displayName !== entry.displayName) reason = `existing customer ${existing.id} has a different display name`;
      if (reason) conflicts.push({ entry, reason });
      else unchanged.push({ entry, customer: existing });
      continue;
    }
    if (reason) {
      conflicts.push({ entry, reason });
      continue;
    }
    const name = normalizedWords(entry.displayName);
    const address = normalizedWords(entry.address);
    if (entry.classification === "normal-historical" && name && address) {
      const matches = customers.filter((customer) => normalizedWords(customer.displayName) === name && normalizedWords(customer.addressLine1) === address);
      if (matches.length > 0) reason = `normalized name/address collides with customer ${matches[0].id}`;
    }
    if (!reason) {
      for (const phone of [entry.phone, entry.alternatePhone].map(normalizedFullPhone).filter(Boolean)) {
        const match = customers.find((customer) => [customer.phone, customer.phone2].map(normalizedFullPhone).includes(phone));
        if (match) {
          reason = `complete phone collides with customer ${match.id}`;
          break;
        }
      }
    }
    if (reason) conflicts.push({ entry, reason });
    else inserts.push(entry);
  }
  return { inserts, unchanged, conflicts };
}

export function customerCreateData(entry, shopId) {
  return {
    shopId,
    legacyCustno: entry.legacyCustomerId,
    displayName: entry.displayName,
    phone: entry.phone,
    phone2: entry.alternatePhone,
    addressLine1: entry.address,
    city: entry.city,
    state: entry.state,
    postalCode: entry.postalCode,
    legacySourceTable: "legacy-customer-recovery.json",
  };
}

function uuidBytes(value) {
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

export function deterministicRecoveredCustomerId(shopId, legacyCustno) {
  const bytes = createHash("sha1")
    .update(uuidBytes(RECOVERED_CUSTOMER_UUID_NAMESPACE))
    .update(`${shopId}\n${legacyCustno.trim()}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function requiredArray(value, label, fatalIssues) {
  if (!Array.isArray(value)) {
    fatalIssues.push({ code: "malformed-manifest", detail: `${label} must be an array` });
    return [];
  }
  return value;
}

function validNonblank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateCutoverRecoveryManifestBinding({ manifest, shopId, sourceFingerprint }) {
  const fatalIssues = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [{ code: "malformed-manifest", detail: "manifest must be an object" }];
  }
  if (manifest.manifestVersion !== CUTOVER_RECOVERY_FORMAT_VERSION) fatalIssues.push({ code: "wrong-format-version" });
  const binding = manifest.sourceBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) fatalIssues.push({ code: "missing-source-binding" });
  else {
    if (binding.sourceFingerprint !== sourceFingerprint) fatalIssues.push({ code: "stale-source-fingerprint" });
    if (binding.shopId !== shopId) fatalIssues.push({ code: "wrong-shop-binding" });
    if (!Array.isArray(binding.sourceTables) || binding.sourceTables.length !== CUTOVER_RECOVERY_SOURCE_TABLES.length ||
      !CUTOVER_RECOVERY_SOURCE_TABLES.every((table) => binding.sourceTables.includes(table))) {
      fatalIssues.push({ code: "wrong-source-tables" });
    }
  }
  const aliases = requiredArray(manifest.existingCustomerAliases, "existingCustomerAliases", fatalIssues);
  const customers = requiredArray(manifest.customersToCreate, "customersToCreate", fatalIssues);
  const unresolved = requiredArray(manifest.unresolvedOrders, "unresolvedOrders", fatalIssues);
  for (const entry of aliases) {
    if (!entry || !validNonblank(entry.legacyCustomerId) || !validNonblank(entry.existingCustomerLegacyId) ||
      !validNonblank(entry.normalizedName) || !validNonblank(entry.normalizedAddress) || entry.reviewStatus !== "approved" ||
      !Array.isArray(entry.applicableLegacyOrderNumbers) || entry.applicableLegacyOrderNumbers.some((order) => !validNonblank(order))) {
      fatalIssues.push({ code: "malformed-alias-entry" });
    }
  }
  for (const entry of customers) {
    if (!entry || !validNonblank(entry.legacyCustomerId) || !validNonblank(entry.displayName) || entry.reviewStatus !== "approved" ||
      !["normal-historical", "historical-unknown"].includes(entry.classification) ||
      !Array.isArray(entry.applicableLegacyOrderNumbers) || entry.applicableLegacyOrderNumbers.some((order) => !validNonblank(order)) ||
      !Array.isArray(entry.associatedLegacyVehicleIds)) fatalIssues.push({ code: "malformed-recovered-customer-entry" });
  }
  for (const entry of unresolved) {
    if (!entry || !validNonblank(entry.legacyOrderNumber) || !validNonblank(entry.legacyCustomerId) || !validNonblank(entry.total) ||
      entry.reviewStatus !== "approved-skip" || entry.disposition !== "keep-skipped") fatalIssues.push({ code: "malformed-unresolved-entry" });
  }
  const expected = manifest.expectedCounts;
  if (!expected || typeof expected !== "object" ||
    expected.aliases !== aliases.length || expected.recoveredCustomers !== customers.length || expected.unresolved !== unresolved.length ||
    expected.recoverableOrders !== [...aliases, ...customers].flatMap((entry) => entry.applicableLegacyOrderNumbers ?? []).length) {
    fatalIssues.push({ code: "manifest-count-mismatch" });
  }
  return fatalIssues;
}

function normalizedSourceReference(reference) {
  const order = reference.legacyRoNo?.trim();
  if (!order) return null;
  return {
    legacyRoNo: order,
    legacyCustno: reference.legacyCustno?.trim() ?? "",
    total: reference.total == null ? null : String(reference.total).trim(),
    sourceTable: reference.sourceTable ?? null,
  };
}

function materialTotalKey(total) {
  if (total == null || total === "") return "missing";
  const cents = parseLegacyMoneyCents(total);
  return cents == null ? `invalid:${total}` : `cents:${cents}`;
}

function materiallyDifferentReferences(references) {
  return new Set(references.map((reference) => `${reference.legacyCustno}\0${materialTotalKey(reference.total)}`)).size > 1;
}

function resolveFallbackReferences(references) {
  let selected = null;
  for (const reference of references) {
    if (!selected) selected = reference;
    else if (selected.legacyCustno !== reference.legacyCustno) selected = { ...reference, conflicting: true, conflictCode: "fallback-source-conflict" };
    else if (!selected.total && reference.total) selected = reference;
  }
  return selected;
}

export function resolveRecoverySourceReferences(references) {
  const groups = new Map();
  for (const reference of references) {
    const normalized = normalizedSourceReference(reference);
    if (!normalized) continue;
    const group = groups.get(normalized.legacyRoNo) ?? [];
    group.push(normalized);
    groups.set(normalized.legacyRoNo, group);
  }

  const map = new Map();
  const diagnostics = {
    finalToArCustomerReferenceDifferences: 0,
    finalOnlyConflictingReferencesIgnored: 0,
    authoritativeArConflicts: 0,
    fallbackResolutions: 0,
  };

  for (const [order, group] of groups) {
    const arReferences = group.filter((reference) => reference.sourceTable?.toLocaleLowerCase("en-US") === "ar.dbf");
    const fallbackReferences = group.filter((reference) => reference.sourceTable?.toLocaleLowerCase("en-US") !== "ar.dbf");
    if (arReferences.length) {
      const authoritative = arReferences[0];
      const arConflict = materiallyDifferentReferences(arReferences);
      if (arConflict) diagnostics.authoritativeArConflicts += 1;
      if (fallbackReferences.some((reference) => reference.legacyCustno !== authoritative.legacyCustno)) {
        diagnostics.finalToArCustomerReferenceDifferences += 1;
      }
      if (new Set(fallbackReferences.map((reference) => reference.legacyCustno)).size > 1) {
        diagnostics.finalOnlyConflictingReferencesIgnored += 1;
      }
      map.set(order, arConflict ? { ...authoritative, conflicting: true, conflictCode: "authoritative-ar-conflict" } : authoritative);
      continue;
    }

    diagnostics.fallbackResolutions += 1;
    const fallback = resolveFallbackReferences(fallbackReferences);
    if (!fallback) continue;
    map.set(order, fallback);
  }
  return { map, diagnostics };
}

export function planCutoverCustomerRecovery({
  stagedCustomers,
  stagedVehicles = [],
  sourceCustomerReferences = [],
  sourceInvoiceArReferences,
  manifest,
  existingAliases = [],
  shopId,
  importRunId,
  sourceFingerprint,
}) {
  const fatalIssues = validateCutoverRecoveryManifestBinding({ manifest, shopId, sourceFingerprint });
  const warnings = [];
  const staleManifestEntries = [];
  const collisions = [];
  const aliases = Array.isArray(manifest?.existingCustomerAliases)
    ? manifest.existingCustomerAliases.filter((entry) => entry && validNonblank(entry.legacyCustomerId) && validNonblank(entry.existingCustomerLegacyId)) : [];
  const customersToCreate = Array.isArray(manifest?.customersToCreate)
    ? manifest.customersToCreate.filter((entry) => entry && validNonblank(entry.legacyCustomerId) && validNonblank(entry.displayName)) : [];
  const approvedUnresolved = Array.isArray(manifest?.unresolvedOrders)
    ? manifest.unresolvedOrders.filter((entry) => entry && validNonblank(entry.legacyOrderNumber) && validNonblank(entry.legacyCustomerId)) : [];
  const referenceResolution = resolveRecoverySourceReferences(Array.isArray(sourceInvoiceArReferences) ? sourceInvoiceArReferences : []);
  const references = referenceResolution.map;
  if (referenceResolution.diagnostics.authoritativeArConflicts) {
    fatalIssues.push({ code: "authoritative-ar-conflict", count: referenceResolution.diagnostics.authoritativeArConflicts });
  }
  const normalByLegacy = new Map();
  const normalById = new Map();
  for (const customer of stagedCustomers ?? []) {
    const legacy = customer.legacyCustno?.trim();
    if (!legacy) continue;
    if (normalByLegacy.has(legacy)) collisions.push({ code: "duplicate-normal-customer", legacyCustno: legacy });
    normalByLegacy.set(legacy, customer);
    if (customer.id) normalById.set(customer.id, customer);
  }
  if (collisions.length) fatalIssues.push({ code: "normal-customer-collision", count: collisions.length });

  const aliasIds = aliases.map((entry) => entry.legacyCustomerId?.trim()).filter(Boolean);
  const recoveredIds = customersToCreate.map((entry) => entry.legacyCustomerId?.trim()).filter(Boolean);
  const normalizedRecoveryIds = [...aliasIds, ...recoveredIds].map((value) => value.toUpperCase());
  for (const duplicate of duplicateValues(normalizedRecoveryIds)) {
    collisions.push({ code: "duplicate-recovery-legacy-id", legacyCustno: duplicate });
  }
  for (const legacyCustno of recoveredIds) {
    if (normalByLegacy.has(legacyCustno)) collisions.push({ code: "recovered-customer-conflicts-with-normal", legacyCustno });
  }
  if (collisions.length) fatalIssues.push({ code: "recovery-collision", count: collisions.length });

  const recoveredEntries = customersToCreate.map((entry) => ({
    ...entry,
    id: deterministicRecoveredCustomerId(shopId, entry.legacyCustomerId),
  }));
  const recoveredIdDuplicates = duplicateValues(recoveredEntries.map((entry) => entry.id));
  if (recoveredIdDuplicates.size) fatalIssues.push({ code: "duplicate-recovered-customer-id", count: recoveredIdDuplicates.size });
  const customerPlan = planCustomerRecovery(recoveredEntries, stagedCustomers ?? [], existingAliases);
  collisions.push(...customerPlan.conflicts.map(({ entry, reason }) => ({ code: "recovered-customer-conflict", legacyCustno: entry.legacyCustomerId, reason })));

  const resolvedAliasEntries = [];
  for (const entry of aliases) {
    const target = normalByLegacy.get(entry.existingCustomerLegacyId?.trim());
    if (!target) {
      collisions.push({ code: "missing-alias-target", legacyCustno: entry.legacyCustomerId });
      continue;
    }
    if (entry.existingCustomerId && normalById.has(entry.existingCustomerId) && entry.existingCustomerId !== target.id) {
      collisions.push({ code: "alias-target-id-conflict", legacyCustno: entry.legacyCustomerId });
      continue;
    }
    resolvedAliasEntries.push({ ...entry, existingCustomerId: target.id });
  }
  const aliasPlan = planAliasRecovery(resolvedAliasEntries, stagedCustomers ?? [], existingAliases);
  collisions.push(...aliasPlan.conflicts.map(({ entry, reason }) => ({ code: "alias-conflict", legacyCustno: entry.legacyCustomerId, reason })));
  if (collisions.length && !fatalIssues.some((issue) => issue.code === "recovery-collision")) fatalIssues.push({ code: "recovery-collision", count: collisions.length });

  const approvedOrderMappings = new Map();
  for (const entry of [...aliases, ...customersToCreate]) {
    if (entry.reviewStatus !== "approved") fatalIssues.push({ code: "unapproved-recovery-entry", legacyCustno: entry.legacyCustomerId });
    for (const order of entry.applicableLegacyOrderNumbers ?? []) {
      if (approvedOrderMappings.has(order)) collisions.push({ code: "duplicate-approved-order", legacyRoNo: order });
      approvedOrderMappings.set(order, entry.legacyCustomerId);
      const source = references.get(order);
      if (!source || source.legacyCustno !== entry.legacyCustomerId || source.conflicting) staleManifestEntries.push({ legacyRoNo: order, code: "recovery-source-evidence-changed" });
    }
  }

  const approvedUnresolvedMap = new Map();
  for (const entry of approvedUnresolved) {
    if (entry.reviewStatus !== "approved-skip" || entry.disposition !== "keep-skipped") fatalIssues.push({ code: "unapproved-unresolved-entry", legacyRoNo: entry.legacyOrderNumber });
    approvedUnresolvedMap.set(entry.legacyOrderNumber, entry);
    const source = references.get(entry.legacyOrderNumber);
    const sourceTotal = source?.total == null ? null : parseLegacyMoneyCents(source.total);
    const approvedTotal = parseLegacyMoneyCents(entry.total);
    if (!source || source.legacyCustno !== entry.legacyCustomerId || source.conflicting || sourceTotal === null || approvedTotal === null || sourceTotal !== approvedTotal) {
      staleManifestEntries.push({ legacyRoNo: entry.legacyOrderNumber, code: "unresolved-source-evidence-changed" });
    }
  }

  const resolvableLegacyIds = new Set([...normalByLegacy.keys(), ...aliasIds, ...recoveredIds]);
  const unresolvedEntries = [];
  const unexpectedUnresolved = [];
  for (const reference of references.values()) {
    if (reference.conflicting) {
      unexpectedUnresolved.push({ ...reference, code: "conflicting-source-reference" });
      continue;
    }
    if (resolvableLegacyIds.has(reference.legacyCustno)) continue;
    const approved = approvedUnresolvedMap.get(reference.legacyRoNo);
    if (approved && approved.legacyCustomerId === reference.legacyCustno) unresolvedEntries.push(reference);
    else unexpectedUnresolved.push(reference);
  }
  if (unexpectedUnresolved.length) fatalIssues.push({ code: "unexpected-unresolved", count: unexpectedUnresolved.length });
  if (staleManifestEntries.length) fatalIssues.push({ code: "stale-manifest-entry", count: staleManifestEntries.length });

  const stagedVehicleIds = new Set((stagedVehicles ?? []).map((vehicle) => vehicle.legacyCarno).filter(Boolean));
  for (const entry of customersToCreate) {
    const missingVehicles = (entry.associatedLegacyVehicleIds ?? []).filter((id) => !stagedVehicleIds.has(id));
    if (missingVehicles.length) warnings.push({ code: "recovery-vehicle-not-normally-staged", legacyCustno: entry.legacyCustomerId, count: missingVehicles.length });
  }
  const stagedSourceCustomerIds = new Set((sourceCustomerReferences ?? []).map((row) => row.legacyCustno).filter(Boolean));
  for (const entry of customersToCreate) {
    if (stagedSourceCustomerIds.has(entry.legacyCustomerId)) warnings.push({ code: "recovered-id-present-in-customer-source", legacyCustno: entry.legacyCustomerId });
  }

  return {
    shopId,
    importRunId,
    sourceFingerprint,
    recoveredLegacyIds: recoveredIds,
    aliasLegacyIds: aliasIds,
    customersToCreate: customerPlan.inserts.map((entry) => ({ ...customerCreateData(entry, shopId), id: entry.id })),
    aliasesToCreate: aliasPlan.inserts.map((entry) => ({
      shopId,
      customerId: entry.existingCustomerId,
      aliasLegacyCustno: entry.legacyCustomerId,
      source: "legacy-customer-recovery.json",
      notes: entry.notes,
    })),
    alreadySatisfied: [...customerPlan.unchanged, ...aliasPlan.unchanged],
    unresolvedEntries,
    unexpectedUnresolved,
    collisions,
    staleManifestEntries,
    warnings,
    fatalIssues,
    referenceDiagnostics: referenceResolution.diagnostics,
    counts: {
      normalCustomers: normalByLegacy.size,
      recoveredCustomers: customerPlan.inserts.length,
      aliases: aliasPlan.inserts.length,
      satisfiedRecoveryEntries: customerPlan.unchanged.length + aliasPlan.unchanged.length,
      approvedUnresolved: unresolvedEntries.length,
      unexpectedUnresolved: unexpectedUnresolved.length,
      aliasCollisions: aliasPlan.conflicts.length,
      finalToArCustomerReferenceDifferences: referenceResolution.diagnostics.finalToArCustomerReferenceDifferences,
      finalOnlyConflictingReferencesIgnored: referenceResolution.diagnostics.finalOnlyConflictingReferencesIgnored,
      authoritativeArConflicts: referenceResolution.diagnostics.authoritativeArConflicts,
      fallbackResolutions: referenceResolution.diagnostics.fallbackResolutions,
      invoiceReferencesResolvedExact: [...references.values()].filter((row) => normalByLegacy.has(row.legacyCustno)).length,
      invoiceReferencesResolvedAlias: [...references.values()].filter((row) => aliasIds.includes(row.legacyCustno)).length,
      invoiceReferencesResolvedRecovered: [...references.values()].filter((row) => recoveredIds.includes(row.legacyCustno)).length,
      remainingUnmatchedReferences: unresolvedEntries.length + unexpectedUnresolved.length,
    },
  };
}

export async function executeCutoverCustomerRecovery({ confirmedWrite, prisma, plan }) {
  if (!confirmedWrite) return { executed: false, databaseWrites: 0 };
  if (!plan || plan.fatalIssues.length) throw new Error("A complete conflict-free Customer recovery plan is required before writing.");
  const databaseWrites = await prisma.$transaction(async (transaction) => {
    const [customerIdConflicts, customerLegacyConflicts, aliasConflicts] = await Promise.all([
      plan.customersToCreate.length ? transaction.customer.count({ where: { id: { in: plan.customersToCreate.map((row) => row.id) } } }) : 0,
      plan.customersToCreate.length ? transaction.customer.count({ where: { shopId: plan.shopId, legacyCustno: { in: plan.customersToCreate.map((row) => row.legacyCustno) } } }) : 0,
      plan.aliasesToCreate.length ? transaction.customerLegacyAlias.count({ where: { shopId: plan.shopId, aliasLegacyCustno: { in: plan.aliasesToCreate.map((row) => row.aliasLegacyCustno) } } }) : 0,
    ]);
    if (customerIdConflicts || customerLegacyConflicts || aliasConflicts) throw new Error("Customer recovery state changed after planning; no recovery rows were written.");
    if (plan.customersToCreate.length) await transaction.customer.createMany({ data: plan.customersToCreate });
    if (plan.aliasesToCreate.length) await transaction.customerLegacyAlias.createMany({ data: plan.aliasesToCreate });
    return plan.customersToCreate.length + plan.aliasesToCreate.length;
  }, { timeout: 120_000 });
  return { executed: true, databaseWrites };
}

export async function runRecoveryBeforeLaterStages({ runRecovery, runLaterStages }) {
  const recoveryResult = await runRecovery();
  await runLaterStages(recoveryResult);
  return recoveryResult;
}

export function manifestOrderSummary(manifest) {
  const aliasOrders = manifest.existingCustomerAliases.flatMap((entry) => entry.applicableLegacyOrderNumbers);
  const creationOrders = manifest.customersToCreate.flatMap((entry) => entry.applicableLegacyOrderNumbers);
  return {
    aliasOrders,
    creationOrders,
    recoverableOrders: [...aliasOrders, ...creationOrders],
    unresolvedOrders: manifest.unresolvedOrders.map((entry) => entry.legacyOrderNumber),
  };
}

export function isMissingAliasTableError(error) {
  return error?.code === "P2021" || error?.meta?.driverAdapterError?.cause?.originalCode === "42P01" || error?.cause?.code === "42P01";
}
