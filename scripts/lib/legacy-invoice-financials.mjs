import {
  calculateShopSuppliesFromSnapshot,
  mapLegacyFinancialBuckets,
} from "./financial-contract.mjs";

export const LEGACY_FINANCIAL_FIELDS = [
  "PARTS", "LABOR", "TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6",
  "TOTAL", "PAYMENT",
];

function rawValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const value = rawData[field];
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value.trim() : null;
}

export function parseLegacyMoneyCents(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const source = String(value).trim();
  // Blank fixed-width DBF numeric fields represent zero; an absent field remains invalid.
  if (source === "") return 0;
  const cleaned = source.replaceAll(/[^0-9.-]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole, fraction = ""] = unsigned.split(".");
  const paddedFraction = fraction.padEnd(3, "0");
  const cents = Number(whole) * 100 + Number(paddedFraction.slice(0, 2)) +
    (Number(paddedFraction[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function centsToDecimal(cents) {
  const negative = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${negative}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function mapLegacyInvoiceFinancials(rawData) {
  const parsed = {};
  const missingOrMalformedFields = [];
  for (const field of LEGACY_FINANCIAL_FIELDS) {
    const cents = parseLegacyMoneyCents(rawValue(rawData, field));
    if (cents === null) missingOrMalformedFields.push(field);
    else parsed[field] = cents;
  }
  if (missingOrMalformedFields.length > 0) {
    return { valid: false, missingOrMalformedFields };
  }

  for (const field of ["DISCOUNT", "DEDUCT"]) {
    const raw = rawValue(rawData, field);
    const cents = raw === null ? 0 : parseLegacyMoneyCents(raw);
    if (cents === null) missingOrMalformedFields.push(field);
    else parsed[field] = cents;
  }
  if (missingOrMalformedFields.length > 0) {
    return { valid: false, missingOrMalformedFields };
  }
  const balance = parseLegacyMoneyCents(rawValue(rawData, "BALANCE"));
  parsed.BALANCE = balance ?? parsed.TOTAL - parsed.PAYMENT;

  const discountsCents = parsed.DISCOUNT + parsed.DEDUCT;
  const mapped = mapLegacyFinancialBuckets({
    partsCents: parsed.PARTS,
    laborCents: parsed.LABOR,
    taxCents: parsed.TAX,
    tax2Cents: parsed.TAX2,
    tax3Cents: parsed.TAX3,
    tax4Cents: parsed.TAX4,
    tax5Cents: parsed.TAX5,
    tax6Cents: parsed.TAX6,
    discountsCents,
    storedInvoiceTotalCents: parsed.TOTAL,
  });

  return {
    valid: true,
    partsCents: parsed.PARTS,
    laborCents: parsed.LABOR,
    // Existing invoice semantics define subtotal as parts plus labor only.
    subtotalCents: parsed.PARTS + parsed.LABOR,
    salesTaxCents: mapped.salesTaxCents,
    shopSuppliesCents: mapped.shopSuppliesCents,
    legacyAdditionalCharges: mapped.legacyAdditionalCharges.map((charge) => ({
      ...charge,
      sourceLabel: null,
      taxable: null,
      legacySourceTable: "ar.DBF",
    })),
    legacyAdditionalChargesCents: mapped.legacyAdditionalChargesCents,
    discountsCents,
    discountCents: parsed.DISCOUNT,
    otherReductionsCents: parsed.DEDUCT,
    totalCents: mapped.invoiceTotalCents,
    paidCents: parsed.PAYMENT,
    balanceCents: parsed.BALANCE,
    reconciliation: mapped.reconciliation,
    missingOrMalformedFields: [],
  };
}

function booleanValue(rawData, field) {
  const value = rawData?.[field];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (["T", "TRUE", "Y", "YES", "1"].includes(normalized)) return true;
  if (["F", "FALSE", "N", "NO", "0", ""].includes(normalized)) return false;
  return null;
}

function laborAmountCents(rawData) {
  const direct = parseLegacyMoneyCents(rawValue(rawData, "LABOR"));
  if (direct !== null) return direct;
  const hours = Number(rawValue(rawData, "HOURS"));
  const rate = Number(rawValue(rawData, "LABORRATE"));
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return null;
  return Math.round(hours * rate * 100);
}

function eligibleLaborEvidence(laborRows) {
  let total = 0;
  const rates = new Set();
  let identifiable = false;
  for (const row of laborRows) {
    if (booleanValue(row.rawData, "TAXABLE2") !== true) continue;
    identifiable = true;
    const laborCents = laborAmountCents(row.rawData);
    const tax2Cents = parseLegacyMoneyCents(rawValue(row.rawData, "TAX2"));
    if (laborCents === null || laborCents < 0) return { identifiable: false };
    total += laborCents;
    if (laborCents > 0 && tax2Cents !== null) {
      for (const rateBasisPoints of [500, 800]) {
        const calculated = calculateShopSuppliesFromSnapshot({
          enabled: true,
          eligibleLaborCents: laborCents,
          rateBasisPoints,
          capCents: Number.MAX_SAFE_INTEGER,
        });
        if (calculated === tax2Cents) rates.add(rateBasisPoints);
      }
    }
  }
  return { identifiable, total, rates };
}

export function inferHistoricalShopSuppliesSnapshot({
  invoiceDate,
  laborRows = [],
  storedShopSuppliesCents,
}) {
  const evidence = eligibleLaborEvidence(laborRows);
  const h1Start = Date.UTC(2026, 0, 1);
  const h1End = Date.UTC(2026, 6, 1);
  const time = invoiceDate?.getTime();
  const confirmedH1Policy = Number.isFinite(time) && time >= h1Start && time < h1End;

  let rateBasisPoints = null;
  let capCents = null;
  if (confirmedH1Policy) {
    rateBasisPoints = 800;
    capCents = 2_000;
  } else if (evidence.rates?.size === 1) {
    const [supportedRate] = evidence.rates;
    const supportedCap = supportedRate === 500 ? 1_500 : 2_000;
    const uncapped = calculateShopSuppliesFromSnapshot({
      enabled: true,
      eligibleLaborCents: evidence.total,
      rateBasisPoints: supportedRate,
      capCents: Number.MAX_SAFE_INTEGER,
    });
    if (storedShopSuppliesCents === supportedCap && uncapped >= supportedCap) {
      rateBasisPoints = supportedRate;
      capCents = supportedCap;
    }
  }

  if (rateBasisPoints === null || capCents === null) {
    return {
      enabled: null,
      rateBasisPoints: null,
      capCents: null,
      taxable: null,
      eligibleLaborCents: null,
      calculatedAmountCents: null,
    };
  }

  const eligibleLaborCents = evidence.identifiable ? evidence.total : null;
  return {
    enabled: true,
    rateBasisPoints,
    capCents,
    taxable: true,
    eligibleLaborCents,
    calculatedAmountCents: eligibleLaborCents === null
      ? null
      : calculateShopSuppliesFromSnapshot({
          enabled: true,
          eligibleLaborCents,
          rateBasisPoints,
          capCents,
        }),
  };
}

export function legacyChargeSynchronization(existingCharges, desiredCharges) {
  const existing = new Map(existingCharges.map((charge) => [charge.sourceBucket, charge]));
  const desired = new Map(desiredCharges.map((charge) => [charge.sourceBucket, charge]));
  return {
    inserts: [...desired.keys()].filter((bucket) => !existing.has(bucket)),
    updates: [...desired.keys()].filter((bucket) => existing.has(bucket)),
    deletes: [...existing.keys()].filter((bucket) => !desired.has(bucket)),
  };
}

export function periodForDate(date) {
  const time = date.getTime();
  if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 1, 1)) return "2026-01";
  if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 6, 1)) return "2026-H1";
  if (time >= Date.UTC(2025, 0, 1) && time < Date.UTC(2026, 0, 1)) return "2025";
  return null;
}
