# PlumWorks database backup scripts (v2)

This version fixes PostgreSQL archive-list parsing for `TABLE DATA` entries.

## Install

Copy this `scripts/db` folder into the PlumWorks repository and overwrite the
earlier files:

```bash
chmod +x scripts/db/*.sh
```

## Create the owner-testing baseline

```bash
./scripts/db/backup-public-db.sh --label before-owner-testing
```

## Verify the newest backup created by an earlier run

```bash
LATEST="$(
  find "$HOME/Projects/Web/plumworks-backups/cardoc/client-testing-baseline" \
    -mindepth 1 -maxdepth 1 -type d |
  sort |
  tail -1
)"

./scripts/db/verify-public-db-backup.sh "$LATEST"
```

## Preview a restore

```bash
./scripts/db/restore-public-db.sh /full/path/to/backup-directory
```

## Confirmed restore

```bash
./scripts/db/restore-public-db.sh /full/path/to/backup-directory \
  --confirm RESTORE_PUBLIC_BASELINE
```

The restore automatically creates a pre-restore safety backup first.
