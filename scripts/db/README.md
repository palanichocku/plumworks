# PlumWorks authoritative public-database backup and restore

The authoritative final-cutover rollback artifact is one PostgreSQL custom-format dump of the Prisma-managed `public` schema. Split `roles.sql`, `schema.sql`, and `data.sql` files are not part of this workflow.

## Create and verify

```sh
./scripts/db/backup-public-db.sh \
  --backup-root "$HOME/Projects/Web/plumworks-backups/cardoc/final-cutover" \
  --label before-final-cutover \
  --shop-id <SHOP_UUID>

./scripts/db/verify-public-db-backup.sh <BACKUP_DIRECTORY> --shop-id <SHOP_UUID>
```

If `--shop-id` is omitted during backup, the database must contain exactly one Shop. The archive is first written with an incomplete suffix, structurally verified, atomically finalized, checksummed, and bound to the redacted database identity and Shop in `manifest.json`.

The archive includes all current public tables and `_prisma_migrations`. It excludes Supabase Auth, Storage objects, roles, ownership, and ACLs. Same-project rollback assumes final cutover did not change Auth or Storage.

## Read-only restore plan

```sh
./scripts/db/restore-public-db.sh <BACKUP_DIRECTORY>
```

This validates the archive, manifest, checksum, target identity, PostgreSQL major version, and extension inventory but performs no write.

## Confirmed restore

```sh
./scripts/db/restore-public-db.sh <BACKUP_DIRECTORY> \
  --confirm RESTORE_PUBLIC_BASELINE
```

Confirmed restore first backs up the target, restores in a single transaction, and verifies exact tables/counts, migrations, financial controls, Shop counter, RLS/policies/privileges, direct access, and membership links to unchanged `auth.users`.

## Required isolated rehearsal

Using `.env.isolated-restore` for a dedicated non-production Supabase project:

```sh
./scripts/db/backup-public-db.sh --env-file .env.isolated-restore \
  --backup-root "$HOME/Projects/Web/plumworks-backups/cardoc/restore-rehearsal" \
  --label before-damage --shop-id <ISOLATED_SHOP_UUID>

# Record controls, then deliberately alter only synthetic public data in the isolated project.

./scripts/db/restore-public-db.sh <BACKUP_DIRECTORY> --env-file .env.isolated-restore
./scripts/db/restore-public-db.sh <BACKUP_DIRECTORY> --env-file .env.isolated-restore \
  --confirm RESTORE_PUBLIC_BASELINE
```

Never run the damage or confirmed restore steps against production. Record the checksum, target, operator, timestamps, commands, duration, verification output, and synthetic application smoke-test result.
