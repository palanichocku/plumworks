export const LEGACY_INVOICE_CONFIRMATION = "TRANSFORM_LEGACY_INVOICES";

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function parseLegacyInvoiceTransformerArguments(argv = []) {
  const parsed = {
    shopId: undefined,
    explicitDryRun: false,
    confirmation: undefined,
    laborOnly: false,
    headersOnly: false,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!["--shop-id", "--dry-run", "--confirm", "--labor-only", "--headers-only"].includes(option)) {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (seen.has(option)) throw new Error(`Duplicate argument: ${option}`);
    seen.add(option);
    if (option === "--dry-run") parsed.explicitDryRun = true;
    else if (option === "--labor-only") parsed.laborOnly = true;
    else if (option === "--headers-only") parsed.headersOnly = true;
    else {
      const value = requireValue(argv, index, option);
      index += 1;
      if (option === "--shop-id") parsed.shopId = value;
      else parsed.confirmation = value;
    }
  }
  if (parsed.confirmation !== undefined && parsed.confirmation !== LEGACY_INVOICE_CONFIRMATION) {
    throw new Error(`--confirm must equal ${LEGACY_INVOICE_CONFIRMATION}.`);
  }
  if (parsed.explicitDryRun && parsed.confirmation === LEGACY_INVOICE_CONFIRMATION) {
    throw new Error("--dry-run cannot be combined with confirmed write authorization.");
  }
  const confirmedWrite = parsed.confirmation === LEGACY_INVOICE_CONFIRMATION;
  return {
    shopId: parsed.shopId,
    dryRun: !confirmedWrite,
    confirmedWrite,
    confirmationStatus: confirmedWrite ? "valid confirmation supplied" : "not supplied",
    laborOnly: parsed.laborOnly,
    headersOnly: parsed.headersOnly,
  };
}

export async function executeLegacyInvoiceWriteTransaction({ confirmedWrite, execute }) {
  if (!confirmedWrite) return { executed: false, result: null, databaseWrites: 0 };
  const result = await execute();
  return { executed: true, result, databaseWrites: result?.databaseWrites ?? 0 };
}
