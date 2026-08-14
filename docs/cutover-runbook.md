# Legacy cutover runbook

For the complete zero-write rehearsal command, including snapshot intake, snapshot-bound recovery validation, Payment projection, count equality, and focused validation, see `docs/legacy-refresh-rehearsal.md` and run `npm run legacy:rehearse` before scheduling the confirmed workflow below.

The licensed shop deployment uses one safe-by-default driver for legacy cutover. The required source argument must point to the accepted immutable snapshot data directory printed by `legacy:snapshot:intake`. Repository seed data is never used as a fallback. The driver reads that folder but never modifies it, and its output contains counts only.

## Dry-run

```sh
npm run legacy:cutover -- \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/legacy-customer-recovery.json \
  --final-cutover-adjudication /protected/plumworks-snapshots/2026-07-31-abc123/active-ro-adjudication.json \
  --snapshot-manifest /protected/plumworks-snapshots/2026-07-31-abc123/manifest.json \
  --payment-date-policy invoice-date-proxy \
  --dry-run
```

This is the default mode. It checks the shop database connection and required source files, reads DBF header row counts, validates the approved Customer recovery plan, builds the exact-run Invoice/AR and Payment projections, and reports the operational rows that would be reset. It performs no writes.

## Snapshot-specific Customer recovery

Some historical Invoice/AR rows reference Customers that cannot be imported normally from `Cust.DBF`. Their reviewed recovery decisions are supplied explicitly with `--customer-recovery-manifest`; the cutover never searches for or chooses a manifest. The version 2 manifest must bind the review to the exact combined source fingerprint, shop UUID, expected source tables, and reviewed recovered/alias/unresolved counts.

A manifest created for the original seed is not valid for a later snapshot. Even when filenames are unchanged, a changed source fingerprint requires regenerating and reviewing the recovery evidence and approving a new manifest. The manifest may keep an unresolved order skipped only when its non-sensitive order/customer identity and authoritative total still exactly match the approved entry. New or materially changed unresolved evidence blocks the cutover.

## Exceptional active Repair Order source adjudication

Strict active-RO acceptance remains the default. An exceptional stale source artifact may be excluded only through a separate versioned `--final-cutover-adjudication` manifest supplied together with the immutable intake `--snapshot-manifest`. This is not Customer recovery and does not create a reusable import rule.

Each approved decision binds the shop, snapshot date, ZIP SHA-256, snapshot-manifest SHA-256, combined source fingerprint, relevant DBF hashes, exact RO number, exact active source table counts, every stable importer row key, and exact finalized-history collision evidence. It records the decision type, classification, reason, reviewer, review timestamp, and explicit approval. Any changed, added, removed, deleted, or undeleted row; changed finalized collision; changed source file; different shop; or unapproved decision fails closed before reset. The confirmed transform validates the same evidence again before writing operational Repair Orders.

These decisions never mean “ignore old ROs,” “ignore invoiced ROs,” or any other heuristic. Every new customer ZIP requires fresh validation. If an artifact disappears from the new ZIP, its prior decision becomes inapplicable and no exclusion is carried forward. Reports list reviewed exclusions separately by RO, decision, classification, reason, row count, and manifest fingerprint.

Omit both adjudication arguments when the accepted snapshot has no reviewed exceptional artifact. Reasons must be non-sensitive and must not contain Customer names, contact details, VINs, or source memo text.

During confirmed replacement, normal Customers and Vehicles are staged and transformed first. Recovered Customers and `CustomerLegacyAlias` rows are then recreated transactionally, before `FINAL`, `laborfinal`, and `ar` are staged and transformed. A recovery conflict or transaction failure stops the workflow before Invoice staging.

The current schema must be deployed before the confirmed command; cutover deletes scoped rows and preserves the existing schema rather than recreating tables. The zero-write rehearsal checks migration files, Prisma schema readiness, and applied migration history without applying anything. In particular, mileage-at-service, complimentary-service, and marketing-attribution migrations must already be present.

Historical mileage and Vendor lineage are immutable source projections: `ar.DBF.ODOMETER` → `Invoice.odometer`, `orders.DBF.ODOMETER` → `RepairOrder.odometer`, `FINAL.DBF.SOURCE` → `InvoicePart.vendorNameSnapshot`, and `orders.DBF.SOURCE` → `RepairOrderPart.vendorNameSnapshot`. `Vehicle.odometer` is only the latest vehicle reading and must never fill missing historical mileage. SOURCE codes remain exact codes when no reliable source lookup proves an expanded name. Imported legacy labor defaults to `complimentary = false`, including zero-value labor.

Clean fresh imports must leave both recovery planners at zero proposed updates, zero conflicts, zero unresolved matches, and zero ambiguity. `legacy:customers:recover`, the Invoice-odometer backfill, and `legacy:backfill:invoice-part-vendors` are post-cutover emergency/diagnostic tools only; they are not normal stages.

Historical Payment tender allocation is part of the complete replacement. After Invoice and Accounts Receivable transformation, the cutover passes that exact staging-run ID and the completed recovery result into the shared hardened Payment projection. `ar.DBF.TOTAL`, `PAYMENT`, and `BALANCE` remain authoritative; Payment rows only preserve normalized tender-bucket detail and never recalculate Invoice paid totals or receivable balances. `--payment-date-policy invoice-date-proxy` is mandatory because the source does not prove receipt timestamps. Reports label these day/month groupings as **Legacy payment tender allocation using Invoice date proxy**, not actual payment chronology. Any reconciliation, identity, recovery, or deterministic-row conflict blocks Payment insertion and prevents open Repair Order staging.

## Snapshot

```sh
node --env-file=.env.local scripts/legacy-cutover.mjs --snapshot
```

## Confirm the managed Supabase backup

Before cutover, open the Supabase dashboard and confirm the project has a recent successful managed backup. If Point-in-Time Recovery is enabled, confirm its recovery window covers the cutover. The local SQL dump created below is an additional recovery artifact, not a replacement for checking the managed backup.

## Local backup only

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), ensure `DIRECT_URL` is configured in `.env.local`, and run:

```sh
npm run legacy:cutover:backup
```

This creates `roles.sql`, `schema.sql`, `data.sql`, and a count-only `manifest.json` in a timestamped `backups/cutover-YYYYMMDD-HHMMSS/` folder. Backup failure aborts the command. Backup and report folders are ignored by Git.

## Confirmed reset and reload

Review the dry-run immediately before cutover. Then run:

```sh
node --env-file=.env.local scripts/legacy-cutover.mjs \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/legacy-customer-recovery.json \
  --final-cutover-adjudication /protected/plumworks-snapshots/2026-07-31-abc123/active-ro-adjudication.json \
  --snapshot-manifest /protected/plumworks-snapshots/2026-07-31-abc123/manifest.json \
  --payment-date-policy invoice-date-proxy \
  --backup \
  --reset-operational-data \
  --reload-legacy \
  --verify \
  --report \
  --confirm RESET_SHOP_OPERATIONAL_DATA
```

The confirmation phrase and `--backup` are mandatory. The backup must complete with all four non-empty files before reset begins. The reset preserves shops, memberships, staff invites, canned services, shop settings, Auth users, migrations, and database security configuration. It clears operational/staging data, including web-created Payments, before importing normal Customers/Vehicles, applying approved Customer recovery, importing Invoices/AR, importing historical Payment tender detail, and importing active open Repair Orders in dependency order.

Only the consolidated confirmed final-cutover driver operationalizes active `orders.DBF` / `LABORorder.DBF` work. Each accepted active order keeps the authoritative Windows number in both `legacyRoNo` and `repairOrderNumber`, but has a null parent `legacySourceTable` so it enters the normal editable workflow. Generic open-order transformation remains historical and read-only. Before reset, final-cutover acceptance rejects invalid or epoch dates, unresolved or ambiguous Customer/Vehicle identity, duplicate destination numbers, and any collision with finalized Invoice history. The shop's next Repair Order number is advanced above accepted imported numbers and is never lowered.

After a confirmed final cutover succeeds and staff begins editing these operationalized orders, do not run the full Windows replacement command again. The cutoff snapshot is a one-way transition, not a merge source; a later replacement would discard PlumWorks edits. Preserve the accepted ZIP/snapshot, cutover report, and pre-cutover database backup as the audit and recovery artifacts.

The confirmation phrase is authorization, not an execution request. A full replacement requires all five execution safeguards together: `--backup`, `--reset-operational-data`, `--reload-legacy`, `--verify`, and `--report`. Supplying confirmation without those flags fails clearly and cannot start a reset.

Run a read-only readiness report before the confirmed command:

```sh
npm run legacy:cutover -- \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/legacy-customer-recovery.json \
  --payment-date-policy invoice-date-proxy \
  --preflight --report
```

Preflight prints the backup destination, rows that would be deleted, authoritative projected reload counts, preserved counts, source and recovery-manifest fingerprints, and projection-count inconsistencies. It never accepts reset, reload, or confirmation flags and performs zero database writes.

## Verify only

```sh
npm run legacy:cutover -- \
  --source /protected/plumworks-snapshots/2026-07-31-abc123/Shopman32/data \
  --customer-recovery-manifest /protected/plumworks-snapshots/2026-07-31-abc123/legacy-customer-recovery.json \
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

Prefer the Supabase dashboard restore or Point-in-Time Recovery when available. The timestamped local SQL dumps provide a secondary manual recovery path using the Supabase CLI/Postgres tooling. Test and document the selected restore procedure before the production cutover.

Never place credentials in command arguments. `.env.local` is loaded by Node and its values are not printed.
