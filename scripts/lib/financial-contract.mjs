const RATE_SCALE = 10_000;

function requireInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
  return value;
}

function multiplyRateAndRound(cents, rateBasisPoints) {
  const amount = BigInt(requireInteger(cents, "cents"));
  const rate = BigInt(requireInteger(rateBasisPoints, "rateBasisPoints"));
  const scale = BigInt(RATE_SCALE);
  const rounded = (amount * rate + scale / 2n) / scale;
  const result = Number(rounded);
  return requireInteger(result, "rounded amount");
}

export function calculateShopSuppliesFromSnapshot({
  enabled,
  eligibleLaborCents,
  rateBasisPoints,
  capCents,
}) {
  requireInteger(eligibleLaborCents, "eligibleLaborCents");
  requireInteger(rateBasisPoints, "rateBasisPoints");
  requireInteger(capCents, "capCents");
  if (!enabled) return 0;
  return Math.min(
    multiplyRateAndRound(eligibleLaborCents, rateBasisPoints),
    capCents,
  );
}

export function calculateOrdinarySalesTax({
  partsCents,
  laborCents,
  shopSuppliesCents,
  partsTaxable,
  laborTaxable,
  shopSuppliesTaxable,
  salesTaxRateBasisPoints,
}) {
  const taxableBaseCents =
    (partsTaxable ? requireInteger(partsCents, "partsCents") : 0) +
    (laborTaxable ? requireInteger(laborCents, "laborCents") : 0) +
    (shopSuppliesTaxable
      ? requireInteger(shopSuppliesCents, "shopSuppliesCents")
      : 0);

  return {
    taxableBaseCents,
    salesTaxCents: multiplyRateAndRound(
      taxableBaseCents,
      salesTaxRateBasisPoints,
    ),
  };
}

export function reconcileInvoiceTotal({
  partsCents,
  laborCents,
  shopSuppliesCents,
  legacyAdditionalChargesCents = 0,
  salesTaxCents,
  discountsCents = 0,
  storedInvoiceTotalCents,
}) {
  const calculatedTotalCents =
    requireInteger(partsCents, "partsCents") +
    requireInteger(laborCents, "laborCents") +
    requireInteger(shopSuppliesCents, "shopSuppliesCents") +
    requireInteger(legacyAdditionalChargesCents, "legacyAdditionalChargesCents") +
    requireInteger(salesTaxCents, "salesTaxCents") -
    requireInteger(discountsCents, "discountsCents");
  const authoritativeTotalCents = requireInteger(
    storedInvoiceTotalCents,
    "storedInvoiceTotalCents",
  );

  return {
    authoritativeTotalCents,
    calculatedTotalCents,
    varianceCents: authoritativeTotalCents - calculatedTotalCents,
    reconciles: authoritativeTotalCents === calculatedTotalCents,
  };
}

export function mapLegacyFinancialBuckets({
  partsCents,
  laborCents,
  taxCents,
  tax2Cents,
  tax3Cents = 0,
  tax4Cents = 0,
  tax5Cents = 0,
  tax6Cents = 0,
  discountsCents = 0,
  storedInvoiceTotalCents,
}) {
  const bucketValues = [
    ["TAX3", tax3Cents],
    ["TAX4", tax4Cents],
    ["TAX5", tax5Cents],
    ["TAX6", tax6Cents],
  ];
  const legacyAdditionalCharges = bucketValues
    .map(([sourceBucket, amountCents]) => ({
      sourceBucket,
      amountCents: requireInteger(amountCents, `${sourceBucket} cents`),
    }))
    .filter(({ amountCents }) => amountCents !== 0);
  const legacyAdditionalChargesCents = legacyAdditionalCharges.reduce(
    (sum, charge) => sum + charge.amountCents,
    0,
  );
  const salesTaxCents = requireInteger(taxCents, "taxCents");
  const shopSuppliesCents = requireInteger(tax2Cents, "tax2Cents");
  const reconciliation = reconcileInvoiceTotal({
    partsCents,
    laborCents,
    shopSuppliesCents,
    legacyAdditionalChargesCents,
    salesTaxCents,
    discountsCents,
    storedInvoiceTotalCents,
  });

  return {
    salesTaxCents,
    shopSuppliesCents,
    legacyAdditionalCharges,
    legacyAdditionalChargesCents,
    invoiceTotalCents: reconciliation.authoritativeTotalCents,
    reconciliation,
  };
}
