# Legacy cutover runbook

For the complete zero-write rehearsal command, including snapshot intake, snapshot-bound recovery validation, Payment projection, count equality, and focused validation, see `docs/legacy-refresh-rehearsal.md` and run `npm run legacy:rehearse` before scheduling the confirmed workflow below.

The licensed shop deployment uses one safe-by-default driver for legacy cutover. The required source argument must point to the accepted immutable snapshot data directory printed by `legacy:snapshot:intake`. Repository seed data is never used as a fallback. The driver reads that folder but never modifies it, and its output contains counts only.

## Dry-run

```sh
npm run legacy:cutover -- \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-proposal /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-proposal.json \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-approval-v4.json \
  --final-cutover-adjudication /protected/plumworks-snapshots/2026-07-31-abc123/active-ro-adjudication.json \
  --snapshot-manifest /protected/plumworks-snapshots/2026-07-31-abc123/manifest.json \
  --payment-date-policy invoice-date-proxy \
  --dry-run
```

This is the default mode. It checks the shop database connection and required source files, reads DBF header row counts, validates the approved Customer and Vehicle recovery plans, builds the exact-run Invoice/AR and Payment projections, and reports the operational rows that would be reset. It performs no writes.

## Snapshot-specific Customer recovery

Some historical Invoice/AR rows reference Customers and Vehicles that cannot be imported normally. Generate a deterministic, non-authorizing proposal from the accepted snapshot, review every Customer and Vehicle candidate, and explicitly create Recovery Approval v4. Final cutover requires both the exact proposal and its approved artifact. The cutover never searches for, chooses, links, creates, or auto-approves either artifact or any recovery disposition.

Version 1/version 2 manifests and Customer-only Approval v3 remain compatibility inputs only and cannot unlock strengthened final-cutover backup or reset. Approval v4 binds the Shop, ZIP, snapshot-manifest SHA-256, combined source fingerprint, each relevant DBF hash, exact proposal bytes, Customer and Vehicle candidate-set hashes, stable source rows/evidence, VIN/plate/YMM/ownership/collision and canonical-target evidence, AR authority, order sets, counts, and review metadata. A new ZIP requires a new proposal and approval. The approval may keep an unresolved order skipped only under the existing exact reviewed zero-dollar policy.

Vehicle review has three explicit outcomes: create an archived recovered historical Vehicle, link the exact reviewed canonical Vehicle, or remain evidence-only with a required reason. Exact VIN agreement is a review candidate, never automatic authorization. Canonical linking preserves the historical Invoice Customer even if the canonical Vehicle currently belongs to a different Customer. Evidence-only leaves the listed Invoices intentionally unlinked and reports that result explicitly.

## Exceptional active Repair Order source adjudication

Strict active-RO acceptance remains the default. An exceptional stale source artifact may be excluded only through a separate versioned `--final-cutover-adjudication` manifest supplied together with the immutable intake `--snapshot-manifest`. This is not Customer recovery and does not create a reusable import rule.

Each approved decision binds the shop, snapshot date, ZIP SHA-256, snapshot-manifest SHA-256, combined source fingerprint, relevant DBF hashes, exact RO number, exact active source table counts, every stable importer row key, and exact finalized-history collision evidence. It records the decision type, classification, reason, reviewer, review timestamp, and explicit approval. Any changed, added, removed, deleted, or undeleted row; changed finalized collision; changed source file; different shop; or unapproved decision fails closed before reset. The confirmed transform validates the same evidence again before writing operational Repair Orders.

These decisions never mean “ignore old ROs,” “ignore invoiced ROs,” or any other heuristic. Every new customer ZIP requires fresh validation. If an artifact disappears from the new ZIP, its prior decision becomes inapplicable and no exclusion is carried forward. Reports list reviewed exclusions separately by RO, decision, classification, reason, row count, and manifest fingerprint.

Omit both adjudication arguments when the accepted snapshot has no reviewed exceptional artifact. Reasons must be non-sensitive and must not contain Customer names, contact details, VINs, or source memo text.

Reviewed source repair is a separate contract. `--final-cutover-active-ro-resolution` may be supplied only with the exact immutable snapshot manifest and explicit final-cutover operational mode. It binds the Shop, ZIP, snapshot-manifest hash, combined fingerprint, relevant DBF hashes, RO, every active row key and evidence hash, deleted state, old Customer value, resolved Customer/Vehicle/date/mileage, exact include or structural-exclude disposition, and human approval metadata.

This is never a rule that Customer `0` means Vehicle owner, missing `RO_DATE` means use another date, or a blank-looking row should be discarded. Without an exact reviewed row-bound decision, those conditions remain blockers. Source repairs and structural exclusions are reported separately from stale-residue adjudications, and a new ZIP requires fresh review.

During confirmed replacement, normal Customers and Vehicles are staged and transformed first. Recovered Customers and `CustomerLegacyAlias` rows are recreated, then the exact reviewed Vehicle plan creates archived historical Vehicles or binds canonical targets before `FINAL`, `laborfinal`, and `ar` are staged and transformed. The reviewed Invoice-to-Vehicle mapping is rechecked and applied before Payment staging. A recovery conflict or transaction failure stops the workflow before the dependent stage.

The current schema must be deployed before the confirmed command; cutover deletes scoped rows and preserves the existing schema rather than recreating tables. The zero-write rehearsal checks migration files, Prisma schema readiness, and applied migration history without applying anything. In particular, mileage-at-service, complimentary-service, and marketing-attribution migrations must already be present.

Historical mileage and Vendor lineage are immutable source projections: `ar.DBF.ODOMETER` → `Invoice.odometer`, `orders.DBF.ODOMETER` → `RepairOrder.odometer`, `FINAL.DBF.SOURCE` → `InvoicePart.vendorNameSnapshot`, and `orders.DBF.SOURCE` → `RepairOrderPart.vendorNameSnapshot`. `Vehicle.odometer` is only the latest vehicle reading and must never fill missing historical mileage. SOURCE codes remain exact codes when no reliable source lookup proves an expanded name. Imported legacy labor defaults to `complimentary = false`, including zero-value labor.

Clean fresh imports must leave both recovery planners at zero proposed updates, zero conflicts, zero unresolved matches, and zero ambiguity. `legacy:customers:recover`, the Invoice-odometer backfill, and `legacy:backfill:invoice-part-vendors` are post-cutover emergency/diagnostic tools only; they are not normal stages.

Historical Payment tender allocation is part of the complete replacement. After Invoice and Accounts Receivable transformation, the cutover passes that exact staging-run ID and the completed recovery result into the shared hardened Payment projection. `ar.DBF.TOTAL`, `PAYMENT`, and `BALANCE` remain authoritative; Payment rows only preserve normalized tender-bucket detail and never recalculate Invoice paid totals or receivable balances. `--payment-date-policy invoice-date-proxy` is mandatory because the source does not prove receipt timestamps. Reports label these day/month groupings as **Legacy payment tender allocation using Invoice date proxy**, not actual payment chronology. Any reconciliation, identity, recovery, or deterministic-row conflict blocks Payment insertion and prevents open Repair Order staging.

## Snapshot

```sh
node --env-file=.env.local scripts/legacy-cutover.mjs --snapshot
```

## Confirm the managed Supabase backup

Before cutover, open the Supabase dashboard and record whether managed backup or Point-in-Time Recovery is available, the most recent restore point, the recovery window, who verified it, and when. Local tooling must not claim this protection is enabled. Managed recovery is secondary protection; the authoritative immediate rollback is the verified custom-format public-schema archive below.

## Local backup only

Ensure `DIRECT_URL`, `pg_dump`, and `pg_restore` are available, then run:

```sh
npm run legacy:cutover:backup
```

This creates exactly one PostgreSQL custom-format `plumworks-public-cutover.dump`, plus `manifest.json`, `sha256.txt`, and `archive-contents.txt`, in a protected timestamped directory outside Git. Split `roles.sql`, `schema.sql`, and `data.sql` files are no longer generated or accepted as rollback authority.

The archive contains every current Prisma-managed `public` table, Shop counters, marketing leads and attribution, staging/import records, `_prisma_migrations`, and public-schema object ACLs. It excludes Supabase Auth, Storage, PostgreSQL roles, and ownership. It is a same-project rollback artifact: the existing Supabase roles must already exist in the target project. It is written under an incomplete name and atomically finalized only after archive structure, exact inventory, RLS, ACL baseline, migration, database/Shop identity, checksum, size, and permissions pass. Reset receives an in-memory gate from that exact verification; a flag or files from another invocation cannot unlock it.

## Explicit cutover lifecycle

The default/legacy invocation remains one-way and fail-closed: an existing `legacy_cutover_completed` marker blocks another full replacement. Historical markers are retained unchanged.

- **Parallel baseline:** Windows remains authoritative. A repeatable baseline replacement requires `--cutover-mode parallel-baseline`, `--windows-authority-through YYYY-MM-DD`, the ordinary reset confirmation, and the separate `REPLACE_PARALLEL_BASELINE_FROM_WINDOWS` confirmation. Success records the non-terminal `legacy_parallel_baseline_completed` event.
- **Final production:** the one-time terminal transition requires `--cutover-mode final-production`, the ordinary reset confirmation, and the separate `FINALIZE_WINDOWS_PRODUCTION_CUTOVER` confirmation. Success records `legacy_final_production_cutover_completed`; after that event, no default, parallel, or final full Windows replacement is permitted.

Explicit parallel or final mode may proceed past historical pre-lifecycle `legacy_cutover_completed` records only with its dedicated confirmation and only while no final-production terminal marker exists. Lifecycle events use `entityType: shop`, so operational reset does not delete them. They are written only after reload and mandatory verification succeed.

## Confirmed reset and reload

Review the dry-run immediately before cutover. Then run:

```sh
node --env-file=.env.local scripts/legacy-cutover.mjs \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-proposal /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-proposal.json \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-approval-v4.json \
  --final-cutover-adjudication /protected/plumworks-snapshots/2026-07-31-abc123/active-ro-adjudication.json \
  --snapshot-manifest /protected/plumworks-snapshots/2026-07-31-abc123/manifest.json \
  --payment-date-policy invoice-date-proxy \
  --backup \
  --reset-operational-data \
  --reload-legacy \
  --verify \
  --report \
  --cutover-mode final-production \
  --confirm-final-production FINALIZE_WINDOWS_PRODUCTION_CUTOVER \
  --confirm RESET_SHOP_OPERATIONAL_DATA
```

The confirmation phrase and `--backup` are mandatory. The authoritative archive and every manifest control must verify before reset begins. The reset preserves shops, memberships, staff invites, canned services, shop settings, Auth users, migrations, and database security configuration. It clears operational/staging data, including web-created Payments, before importing normal Customers/Vehicles, applying approved Customer recovery, importing Invoices/AR, importing historical Payment tender detail, and importing active open Repair Orders in dependency order.

Only the consolidated confirmed final-cutover driver operationalizes active `orders.DBF` / `LABORorder.DBF` work. Each accepted active order keeps the authoritative Windows number in both `legacyRoNo` and `repairOrderNumber`, but has a null parent `legacySourceTable` so it enters the normal editable workflow. Generic open-order transformation remains historical and read-only. Before reset, final-cutover acceptance rejects invalid or epoch dates, unresolved or ambiguous Customer/Vehicle identity, duplicate destination numbers, and any collision with finalized Invoice history. The shop's next Repair Order number is advanced above accepted imported numbers and is never lowered.

After a confirmed final-production cutover succeeds, Windows becomes read-only and the terminal audit marker prevents every later full Windows replacement. Parallel-baseline data is disposable only while Windows remains explicitly authoritative. Preserve each accepted ZIP/snapshot, cutover report, and pre-cutover database backup as audit and recovery artifacts.

The confirmation phrase is authorization, not an execution request. A full replacement requires all five execution safeguards together: `--backup`, `--reset-operational-data`, `--reload-legacy`, `--verify`, and `--report`. Supplying confirmation without those flags fails clearly and cannot start a reset.

Run a read-only readiness report before the confirmed command:

```sh
npm run legacy:cutover -- \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-proposal /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-proposal.json \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-approval-v4.json \
  --snapshot-manifest /protected/plumworks-snapshots/2026-07-31-abc123/manifest.json \
  --payment-date-policy invoice-date-proxy \
  --preflight --report
```

Preflight prints the backup destination, rows that would be deleted, authoritative projected reload counts, preserved counts, source and recovery-manifest fingerprints, and projection-count inconsistencies. It never accepts reset, reload, or confirmation flags and performs zero database writes.

## Verify only

```sh
npm run legacy:cutover -- \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-proposal /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-proposal.json \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/customer-recovery-approval-v4.json \
  --snapshot-manifest /protected/plumworks-snapshots/2026-07-31-abc123/manifest.json \
  --payment-date-policy invoice-date-proxy \
  --verify --report
```

Verification reports counts only, confirms server-side Prisma access, and checks that all Prisma-managed public tables retain RLS with browser API privileges revoked.

## Reports and status

With `--report`, the driver prints a final summary and saves:

- `reports/cutover-YYYYMMDD-HHMMSS.md`
- `reports/cutover-YYYYMMDD-HHMMSS.json`

Status meanings:

- `PASS`: required checks completed without warnings.
- `PASS WITH WARNINGS`: checks passed, with expected raw-to-clean gaps or a dry-run notice requiring review.
- `FAIL`: at least one critical issue occurred. Do not use the reloaded application until it is resolved.

Critical issues appear at both the top and bottom of the Markdown report. `--summary-only` still performs the requested workflow but emphasizes the final formatted summary.

## Rollback

The rollback decision point is before accepting or using the reloaded application. If reset/reload or exact reconciliation fails, stop writes and first validate the authoritative archive without writing:

```sh
./scripts/db/restore-public-db.sh /protected/plumworks-backups/cardoc/final-cutover/cutover-YYYYMMDD-HHMMSS
```

After reviewed approval, restore the same project with:

```sh
./scripts/db/restore-public-db.sh /protected/plumworks-backups/cardoc/final-cutover/cutover-YYYYMMDD-HHMMSS \
  --confirm RESTORE_PUBLIC_BASELINE
```

Confirmed restore validates archive/manifest/checksum and target identity again, creates a new safety archive, and runs `pg_restore --clean --if-exists --no-owner --single-transaction`. Success additionally requires exact table counts, migration and financial controls, Shop counter, RLS/policy/exact privilege checks, direct database access, and ShopMembership-to-Auth linkage.

Ownership remains excluded, but public object ACLs are preserved and the exact anon, authenticated, service_role, and PUBLIC privilege matrix is verified. The archive is for same-project public-schema rollback; `auth.users`, stored file bytes, PostgreSQL roles, and external configuration remain outside it. Before production cutover, exercise this exact workflow with synthetic representative data in a dedicated isolated Supabase project. Managed Supabase backup/PITR remains secondary protection.

Never place credentials in command arguments. `.env.local` is loaded by Node and its values are not printed.
