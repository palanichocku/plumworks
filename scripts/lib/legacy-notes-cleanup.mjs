export const LEGACY_RECOVERY_PREFIX = "[legacy recovery:";
export const OBJECT_NOTE = "[object Object]";
export const CLEANUP_CONFIRMATION = "CLEAN_LEGACY_INTERNAL_NOTES";

export function parseLegacyNotesCleanupArguments(argv) {
  if (argv.length === 0) return { dryRun: true, confirmation: null };
  if (argv.length !== 2 || argv[0] !== "--confirm" || !argv[1]) throw new Error(`Only --confirm ${CLEANUP_CONFIRMATION} is supported.`);
  if (argv[1] !== CLEANUP_CONFIRMATION) throw new Error(`--confirm must equal ${CLEANUP_CONFIRMATION}.`);
  return { dryRun: false, confirmation: argv[1] };
}

export function classifyLegacyNotes(customers, vehicles) {
  const affectedCustomers = customers.filter((row) => typeof row.notes === "string" && row.notes.startsWith(LEGACY_RECOVERY_PREFIX));
  const affectedVehicles = vehicles.filter((row) => typeof row.notes === "string" && row.notes.trim() === OBJECT_NOTE);
  const preservedCustomers = customers.filter((row) => typeof row.notes === "string" && row.notes.trim() && !row.notes.startsWith(LEGACY_RECOVERY_PREFIX));
  const preservedVehicles = vehicles.filter((row) => typeof row.notes === "string" && row.notes.trim() && row.notes.trim() !== OBJECT_NOTE);
  const provenance = (rows) => ({ legacy: rows.filter((row) => row.legacySourceTable || row.legacyCustno || row.legacyCarno).length, web: rows.filter((row) => !row.legacySourceTable && !row.legacyCustno && !row.legacyCarno).length });
  return { affectedCustomers, affectedVehicles, preservedCustomers, preservedVehicles, customerProvenance: provenance(customers), vehicleProvenance: provenance(vehicles) };
}

export async function runLegacyNotesCleanup({ createBackup, transaction }) {
  const checkpoint = await createBackup();
  const result = await transaction();
  return { checkpoint, result };
}

export function affectedNotesIntegrity(customers, vehicles) {
  return JSON.stringify({
    customers: customers.map(({ id, shopId, notes }) => ({ id, shopId, notes })),
    vehicles: vehicles.map(({ id, shopId, notes }) => ({ id, shopId, notes })),
  });
}

export function assertCleanupIntegrity(expected, actual) {
  if (expected !== actual) throw new Error("Affected notes changed after backup; cleanup rolled back.");
}

export function assertCleanupCounts(expectedCustomers, updatedCustomers, expectedVehicles, updatedVehicles, remainingCustomers, remainingVehicles) {
  if (updatedCustomers !== expectedCustomers || updatedVehicles !== expectedVehicles) throw new Error("Cleanup update count mismatch; cleanup rolled back.");
  if (remainingCustomers !== 0 || remainingVehicles !== 0) throw new Error("Matching legacy notes remain after cleanup; cleanup rolled back.");
}
