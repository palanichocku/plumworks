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
