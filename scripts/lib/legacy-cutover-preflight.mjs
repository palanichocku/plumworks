export const LEGACY_CUTOVER_CONFIRMATION = "RESET_SHOP_OPERATIONAL_DATA";

const REQUIRED_FULL_REPLACEMENT_FLAGS = Object.freeze([
  "--backup",
  "--reset-operational-data",
  "--reload-legacy",
  "--verify",
  "--report",
]);

export function parseLegacyCutoverExecution(argv = []) {
  const flags = new Set(argv.filter((value) => value.startsWith("--")));
  const confirmationPositions = argv.flatMap((value, index) => value === "--confirm" ? [index] : []);
  if (confirmationPositions.length > 1) throw new Error("--confirm may be supplied only once.");
  const confirmation = confirmationPositions.length ? argv[confirmationPositions[0] + 1] : null;
  const preflight = flags.has("--preflight");
  const explicitDryRun = flags.has("--dry-run");
  const requestedDestructiveStage = flags.has("--reset-operational-data") || flags.has("--reload-legacy");
  const missingFullReplacementFlags = REQUIRED_FULL_REPLACEMENT_FLAGS.filter((flag) => !flags.has(flag));

  if (confirmation && confirmation !== LEGACY_CUTOVER_CONFIRMATION) {
    throw new Error(`--confirm must equal ${LEGACY_CUTOVER_CONFIRMATION}.`);
  }
  if (confirmation && !requestedDestructiveStage) {
    throw new Error("Confirmation alone cannot start a cutover; the full replacement execution flags are required.");
  }
  if (explicitDryRun && confirmation) throw new Error("--dry-run cannot be combined with cutover confirmation.");
  if (preflight && (confirmation || requestedDestructiveStage)) {
    throw new Error("--preflight cannot be combined with confirmation, reset, or reload flags.");
  }
  if (requestedDestructiveStage && missingFullReplacementFlags.length) {
    throw new Error(`Full replacement requires ${missingFullReplacementFlags.join(", ")}.`);
  }
  if (requestedDestructiveStage && confirmation !== LEGACY_CUTOVER_CONFIRMATION) {
    throw new Error(`Full replacement requires --confirm ${LEGACY_CUTOVER_CONFIRMATION}.`);
  }

  return {
    preflight,
    dryRun: preflight || explicitDryRun || !requestedDestructiveStage,
    confirmedFullReplacement: requestedDestructiveStage && confirmation === LEGACY_CUTOVER_CONFIRMATION,
    requiredFullReplacementFlags: [...REQUIRED_FULL_REPLACEMENT_FLAGS],
    missingFullReplacementFlags,
  };
}

export function authoritativeReloadCounts({
  normalCustomers,
  recoveredCustomers,
  aliases,
  vehicles,
  invoiceProjection,
  rawFinal,
  rawLabor,
  paymentProjection,
  openOrders,
}) {
  const invoiceIds = new Set(invoiceProjection.invoices.map((invoice) => invoice.legacyRoNo));
  const text = (rawData, field) => {
    const value = rawData?.[field];
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  };
  return {
    customers: normalCustomers + recoveredCustomers,
    recoveredCustomers,
    customerAliases: aliases,
    vehicles,
    invoices: invoiceProjection.invoices.length,
    invoice_parts: rawFinal.filter((row) => row.legacyRoNo && invoiceIds.has(row.legacyRoNo) && (text(row.rawData, "PARTNO") || text(row.rawData, "DESC"))).length,
    invoice_labor: rawLabor.filter((row) => row.legacyRoNo && invoiceIds.has(row.legacyRoNo)).length,
    accounts_receivable: invoiceProjection.invoices.length,
    payments: paymentProjection.proposedRows.length,
    repair_orders: openOrders.orders,
    repair_order_parts: openOrders.parts,
    repair_order_labor: openOrders.labor,
  };
}

export function validateProjectedCountConsistency({ expected, invoiceProjection, paymentProjection, reconciliationExpected = expected }) {
  const issues = [];
  if (expected.invoices !== invoiceProjection.invoices.length) issues.push("Invoice expected count differs from the active Invoice projection.");
  if (expected.accounts_receivable !== invoiceProjection.invoices.length) issues.push("AR expected count differs from the active Invoice projection.");
  if (paymentProjection.matchedInvoiceCount !== invoiceProjection.invoices.length) issues.push("Payment matched-Invoice count differs from the active Invoice projection.");
  if (expected.payments !== paymentProjection.proposedRows.length) issues.push("Payment expected count differs from the active Payment projection.");
  if (reconciliationExpected.invoices !== expected.invoices) issues.push("Reported Invoice reconciliation count differs from the authoritative projection.");
  if (reconciliationExpected.accounts_receivable !== expected.accounts_receivable) issues.push("Reported AR reconciliation count differs from the authoritative projection.");
  return issues;
}
