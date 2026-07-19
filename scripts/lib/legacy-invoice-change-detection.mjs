function normalizeDecimal(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return String(value);
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return magnitude === "0" ? "0" : `${match[1]}${magnitude}`;
}

function normalizeDate(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

const scalar = (value) => value ?? null;

export const PERSISTED_FIELDS = {
  invoice: {
    customerId: [scalar, "customer/vehicle relationship"],
    vehicleId: [scalar, "customer/vehicle relationship"],
    status: [scalar, "status"],
    invoiceDate: [normalizeDate, "invoice date"],
    partsTotal: [normalizeDecimal, "financial"],
    laborTotal: [normalizeDecimal, "financial"],
    subtotal: [normalizeDecimal, "financial"],
    taxTotal: [normalizeDecimal, "financial"],
    total: [normalizeDecimal, "financial"],
    paidTotal: [normalizeDecimal, "financial"],
    shopSuppliesAmount: [normalizeDecimal, "financial"],
    shopSuppliesEnabledSnapshot: [scalar, "shop-supplies snapshot"],
    shopSuppliesRateSnapshot: [normalizeDecimal, "shop-supplies snapshot"],
    shopSuppliesCapSnapshot: [normalizeDecimal, "shop-supplies snapshot"],
    shopSuppliesTaxableSnapshot: [scalar, "shop-supplies snapshot"],
    shopSuppliesEligibleLaborTotal: [normalizeDecimal, "shop-supplies snapshot"],
    shopSuppliesCalculatedAmount: [normalizeDecimal, "shop-supplies snapshot"],
    shopSuppliesWasOverridden: [scalar, "override metadata"],
    legacySourceTable: [scalar, "legacy source metadata"],
  },
  invoicePart: {
    invoiceId: [scalar, "relationship"], description: [scalar, "description"],
    partNumber: [scalar, "part number"], quantity: [normalizeDecimal, "amount"],
    unitPrice: [normalizeDecimal, "amount"], legacyRoNo: [scalar, "legacy source metadata"],
    legacySourceTable: [scalar, "legacy source metadata"],
  },
  invoiceLabor: {
    invoiceId: [scalar, "relationship"], description: [scalar, "description"],
    hours: [normalizeDecimal, "amount"], hourlyRate: [normalizeDecimal, "amount"],
    legacyRoNo: [scalar, "legacy source metadata"], legacySourceTable: [scalar, "legacy source metadata"],
  },
  accountReceivable: {
    invoiceId: [scalar, "relationship"], customerId: [scalar, "relationship"],
    balance: [normalizeDecimal, "balance/status"], status: [scalar, "balance/status"],
    legacySourceTable: [scalar, "legacy source metadata"],
  },
  invoiceLegacyCharge: {
    amount: [normalizeDecimal, "amount"], sourceLabel: [scalar, "source metadata"],
    taxable: [scalar, "taxability"], legacySourceTable: [scalar, "source metadata"],
  },
};

export function comparePersistedRows(model, proposed, existing) {
  const fields = PERSISTED_FIELDS[model];
  if (!fields) throw new Error(`Unknown persisted comparison model: ${model}`);
  const changedFields = [];
  const reasons = new Set();
  for (const [field, [normalize, reason]] of Object.entries(fields)) {
    if (normalize(proposed[field]) !== normalize(existing[field])) {
      changedFields.push(field);
      reasons.add(reason);
    }
  }
  return { changed: changedFields.length > 0, changedFields, reasons: [...reasons] };
}

export function classifyPersistedRows({ model, proposedRows, existingRows, identity }) {
  const existingByIdentity = new Map(existingRows.map((row) => [identity(row), row]));
  const result = { inserts: [], updates: [], unchanged: [] };
  for (const proposed of proposedRows) {
    const existing = existingByIdentity.get(identity(proposed));
    if (!existing) result.inserts.push({ proposed, existing: null, changedFields: [], reasons: [] });
    else {
      const comparison = comparePersistedRows(model, proposed, existing);
      result[comparison.changed ? "updates" : "unchanged"].push({ proposed, existing, ...comparison });
    }
  }
  return result;
}

export function writableClassifications(classification) {
  return [...classification.inserts, ...classification.updates];
}
