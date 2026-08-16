#!/usr/bin/env node
import { createRecoveryApproval, RECOVERY_APPROVAL_CONFIRMATION } from "./lib/legacy-customer-recovery-proposal.mjs";

function value(args, name) {
  const positions = args.flatMap((item, index) => item === name ? [index] : []);
  if (positions.length !== 1) throw new Error(`${name} must be provided exactly once.`);
  const result = args[positions[0] + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
  return result;
}

const args = process.argv.slice(2);
const allowed = new Set(["--proposal", "--snapshot-manifest", "--reviewed-decisions", "--reviewed-by", "--reviewed-at", "--reason", "--output", "--confirm"]);

try {
  for (const item of args) if (item.startsWith("--") && !allowed.has(item)) throw new Error(`Unknown argument: ${item}`);
  if (value(args, "--confirm") !== RECOVERY_APPROVAL_CONFIRMATION) throw new Error(`--confirm must equal ${RECOVERY_APPROVAL_CONFIRMATION}.`);
  const result = await createRecoveryApproval({
    proposalPath: value(args, "--proposal"),
    snapshotManifestPath: value(args, "--snapshot-manifest"),
    reviewedDecisionsPath: value(args, "--reviewed-decisions"),
    reviewedBy: value(args, "--reviewed-by"),
    reviewedAt: value(args, "--reviewed-at"),
    reason: value(args, "--reason"),
    output: value(args, "--output"),
  });
  console.log(`Approved Customer and Vehicle recovery v4 artifact created: ${result.output}`);
  console.log(`proposal SHA-256: ${result.proposalSha256}`);
  console.log(`reviewed decisions: ${result.approval.decisions.length}`);
  console.log(`reviewed Vehicle decisions: ${result.approval.vehicleDecisions.length}`);
  console.log("database writes performed: 0");
} catch (error) {
  console.error(`Customer recovery approval failed: ${error instanceof Error ? error.message : "Unknown error."}`);
  process.exitCode = 1;
}
