import { parseRecoveryUpgradeArguments, runRecoveryUpgrade } from "./lib/legacy-recovery-upgrade.mjs";

try {
  const options = parseRecoveryUpgradeArguments(process.argv.slice(2));
  const result = await runRecoveryUpgrade(options);
  console.log(`old format version: ${result.summary.oldFormatVersion}`);
  console.log(`proposed format version: ${result.summary.proposedFormatVersion}`);
  console.log(`input manifest SHA-256: ${result.summary.inputManifestSha256}`);
  console.log(`source fingerprint match: ${result.summary.sourceFingerprintMatch ? "yes" : "no"}`);
  console.log(`shop match: ${result.summary.shopMatch ? "yes" : "no"}`);
  console.log(`recovered Customer count: ${result.summary.recoveredCustomers}`);
  console.log(`alias count: ${result.summary.aliases}`);
  console.log(`approved unresolved count: ${result.summary.approvedUnresolved}`);
  console.log(`recoverable-order count: ${result.summary.recoverableOrders}`);
  console.log(`satisfied entry count: ${result.summary.satisfiedEntries}`);
  console.log(`stale entry count: ${result.summary.staleEntries}`);
  console.log(`collision count: ${result.summary.collisions}`);
  console.log(`unexpected unresolved count: ${result.summary.unexpectedUnresolved}`);
  console.log(`FINAL-to-AR Customer-reference differences: ${result.summary.referenceDiagnostics.finalToArCustomerReferenceDifferences}`);
  console.log(`FINAL-only conflicts ignored with authoritative AR: ${result.summary.referenceDiagnostics.finalOnlyConflictingReferencesIgnored}`);
  console.log(`authoritative AR conflict count: ${result.summary.referenceDiagnostics.authoritativeArConflicts}`);
  console.log(`FINAL fallback resolution count: ${result.summary.referenceDiagnostics.fallbackResolutions}`);
  console.log(`fatal issue count: ${result.summary.fatalIssues}`);
  console.log(`output file writes performed: ${result.summary.outputFileWritesPerformed}`);
} catch (error) {
  console.error(`Legacy recovery manifest upgrade failed: ${error instanceof Error ? error.message : "Unknown error."}`);
  process.exitCode = 1;
}
