#!/usr/bin/env node
import { writeRecoveryProposal } from "./lib/legacy-customer-recovery-proposal.mjs";

function value(args, name) {
  const positions = args.flatMap((item, index) => item === name ? [index] : []);
  if (positions.length !== 1) throw new Error(`${name} must be provided exactly once.`);
  const result = args[positions[0] + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
  return result;
}

const args = process.argv.slice(2);
const allowed = new Set(["--snapshot-manifest", "--shop-id", "--output"]);
for (const item of args) if (item.startsWith("--") && !allowed.has(item)) throw new Error(`Unknown argument: ${item}`);

try {
  const result = await writeRecoveryProposal({
    snapshotManifestPath: value(args, "--snapshot-manifest"),
    shopId: value(args, "--shop-id"),
    output: value(args, "--output"),
  });
  console.log(`Customer recovery proposal created: ${result.output}`);
  console.log("authorization: none (proposal only)");
  console.log(`candidate set SHA-256: ${result.proposal.candidateSetSha256}`);
  console.log(`candidate decisions: ${result.proposal.candidates.length}`);
  console.log(`unresolved candidates requiring review: ${result.proposal.unresolvedCandidates.length}`);
  console.log("database writes performed: 0");
} catch (error) {
  console.error(`Customer recovery proposal generation failed: ${error instanceof Error ? error.message : "Unknown error."}`);
  process.exitCode = 1;
}
