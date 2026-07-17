# Legacy cutover runbook

The licensed shop deployment uses one safe-by-default driver for legacy cutover. The source argument must point to the latest `Shopman32/data` folder. The driver reads that folder but never modifies it, and its output contains counts only.

## Dry-run

```sh
npm run legacy:cutover:dry-run -- --source /path/to/Shopman32/data
```

This is the default mode. It checks the shop database connection and required source files, reads DBF header row counts, and reports the operational rows that would be reset. It performs no writes.

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
  --source /path/to/Shopman32/data \
  --backup \
  --reset-operational-data \
  --reload-legacy \
  --verify \
  --report \
  --confirm RESET_SHOP_OPERATIONAL_DATA
```

The confirmation phrase and `--backup` are mandatory. The backup must complete with all four non-empty files before reset begins. The reset preserves shops, memberships, staff invites, canned services, shop settings, Auth users, migrations, and database security configuration. It clears only operational/staging data before importing customers, vehicles, invoices, AR, and open repair orders in dependency order.

## Verify only

```sh
npm run legacy:cutover:verify
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
