# Legacy parallel refresh operator workflow

> **DO NOT REDISCOVER THE LEGACY CUTOVER ARCHITECTURE. USE THESE AUTHORITATIVE COMMANDS AND ARTIFACTS.**

This wrapper coordinates the proven snapshot intake, Recovery Approval v4, active-RO review, consolidated preflight, verified public-schema backup, shop-scoped reset, import, reconciliation, and reporting tools. It does not replace or reimplement them.

Deployment identity and safe defaults live in `config/legacy-parallel-refresh.json`. The database URL remains environment-owned and is never written to a run artifact.

## 1. Prepare — zero production writes

```sh
npm run legacy:parallel-refresh:prepare -- \
  --zip ~/Downloads/shopman32.zip \
  --windows-authority-through YYYY-MM-DD
```

Preparation creates one immutable snapshot/run beneath `~/Projects/Web/plumworks-backups/cardoc/parallel-baseline/YYYY-MM-DD/`. It validates ZIP integrity, required files, the accepted DBF schema fingerprint, full and scoped SHA-256 bindings, creates a deterministic Customer/Vehicle recovery proposal, summarizes active-order evidence, and writes compact JSON/Markdown summaries. It performs no database writes and creates no approval.

For deterministic comparison with the most recently approved permanent-workflow run:

```sh
npm run legacy:parallel-refresh:prepare -- \
  --zip ~/Downloads/shopman32.zip \
  --windows-authority-through YYYY-MM-DD \
  --baseline-run <prior-run-id>
```

The terminal output is intentionally short. Open detailed evidence only when the summary reports a changed/new candidate, changed schema, unresolved active RO, or another blocker.
`evidence/recovery-candidates.json` contains compact candidate identities, affected order numbers, prior decision mappings, and proposal suggestions. `evidence/active-ro-candidates.json` contains compact RO/customer/vehicle/date/mileage/labor/finalized-collision evidence. Neither file authorizes a decision.

## 2. Review and approve

```sh
npm run legacy:parallel-refresh:review -- --run <run-id>
```

Only human-reviewed, newly generated artifacts may authorize a snapshot:

- `recovery/customer-vehicle-recovery-proposal.json`
- `recovery/customer-vehicle-recovery-approval-v4.json`
- `approvals/active-ro-stale-adjudication-approved.json` when stale/finalized source residue is approved
- `approvals/active-ro-resolution-approved.json` when a genuine active RO requires reviewed source resolution

Candidate-set equivalence and prior decision availability reduce review effort but **never authorize reuse automatically**. Generate a genuine Approval v4 with the existing command:

```sh
npm run legacy:recovery:approve -- \
  --proposal <run>/recovery/customer-vehicle-recovery-proposal.json \
  --snapshot-manifest <run>/manifest.json \
  --reviewed-decisions <private-reviewed-decisions.json> \
  --reviewed-by <reviewer> \
  --reviewed-at <ISO-8601> \
  --reason <review-reason> \
  --output <run>/recovery/customer-vehicle-recovery-approval-v4.json \
  --confirm APPROVE_CUSTOMER_RECOVERY_V4
```

Active-RO evidence is in `evidence/active-ro-candidates.json`. Review every listed RO. A `FINALIZED_STALE_CANDIDATE` label is evidence for review, not approval. Use the existing v1 adjudication/resolution artifact formats; never copy an old approval and edit its snapshot fields.

Run review again until it reports `APPROVED — READY FOR PREFLIGHT`.

## 3. Execute — confirmed production replacement

```sh
npm run legacy:parallel-refresh:execute -- \
  --run <run-id> \
  --confirm REPLACE_PARALLEL_BASELINE_FROM_WINDOWS
```

The wrapper verifies the configured production fingerprint, Shop identity, migration status, run bindings, and approvals, then delegates to `scripts/legacy-cutover.mjs` with the established mandatory backup/reset/reload/verify/report flags. The consolidated driver remains authoritative for backup gates, reset scope, imports, counters, reconciliation, lifecycle markers, and final reports.

Never run execute against Transaction Pooler port 6543. Use the configured Supavisor Session connection on port 5432 for controlled migration/backup/cutover transport.

## 4. Status and artifacts

```sh
npm run legacy:parallel-refresh:status -- --run <run-id>
```

Each run contains:

```text
manifest.json
run-state.json
prepare-summary.json
prepare-summary.md
recovery/
approvals/
evidence/
preflight/
cutover/
```

Run-state transitions are monotonic, informational records. They are not authorization. Snapshot-bound approval hashes remain authoritative.

## Stop conditions

Stop immediately for any ZIP/schema/source mismatch, changed or missing bound file, unresolved recovery conflict, missing approval, wrong production fingerprint/Shop, pending migration, changed reset scope, backup failure, reset/reload failure, reconciliation failure, or orphan/integrity failure. Never weaken a validator or perform ad-hoc production repair.

## Recovery after a post-reset failure

The execute wrapper prints the fail-closed recovery direction. Use the verified custom-format backup and the established restore procedure in `docs/cutover-runbook.md` and `scripts/db/README.md`. Do not rerun partial stages or manually patch production rows.

## Expected operator/Codex behavior

Future sessions should read this document and the compact `prepare-summary.json`; they should not print entire DBFs, inspect large proposal files, rediscover reset semantics, or manually calculate candidate/count differences. Detailed artifacts remain on disk for exceptions and audit evidence.
