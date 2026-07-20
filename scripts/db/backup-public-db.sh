#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/db/backup-public-db.sh [options]

Options:
  --backup-root PATH   Root directory for backups.
  --label NAME         Backup label. Default: baseline
  --env-file PATH      Environment file. Default: <repo>/.env.local
  -h, --help           Show this help.
EOF
}

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/Projects/Web/plumworks-backups/cardoc/client-testing-baseline}"
LABEL="baseline"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-root)
      [[ $# -ge 2 ]] || die "--backup-root requires a path."
      BACKUP_ROOT="$2"
      shift 2
      ;;
    --label)
      [[ $# -ge 2 ]] || die "--label requires a value."
      LABEL="$2"
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file requires a path."
      ENV_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

require_command pg_dump
require_command pg_restore
require_command psql
require_command git
require_command node

LABEL="$(sanitize_label "$LABEL")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/${LABEL}-${STAMP}"
DUMP_FILE="$BACKUP_DIR/cardoc-public-${LABEL}.dump"
ARCHIVE_LIST="$BACKUP_DIR/archive-contents.txt"
ROW_COUNTS="$BACKUP_DIR/public-row-counts.tsv"
CHECKSUM_FILE="$BACKUP_DIR/sha256.txt"
MANIFEST_FILE="$BACKUP_DIR/backup-manifest.txt"
MIGRATION_STATUS_FILE="$BACKUP_DIR/prisma-migrate-status.txt"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

DB_URL="$(load_direct_url "$ENV_FILE")"
TARGET="$(redacted_db_target "$DB_URL")"

printf 'Creating public-schema backup from %s\n' "$TARGET"

pg_dump \
  --dbname="$DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="$DUMP_FILE"

pg_restore --list "$DUMP_FILE" > "$ARCHIVE_LIST"
write_exact_public_row_counts "$DB_URL" "$ROW_COUNTS"

if [[ -f "$REPO_ROOT/node_modules/prisma/build/index.js" ]]; then
  (
    cd "$REPO_ROOT"
    node --env-file="$ENV_FILE" ./node_modules/prisma/build/index.js migrate status
  ) > "$MIGRATION_STATUS_FILE" 2>&1 || true
else
  printf 'Prisma CLI not available at node_modules/prisma/build/index.js\n' > "$MIGRATION_STATUS_FILE"
fi

unset DB_URL

CHECKSUM="$(sha256_file "$DUMP_FILE")"
SIZE_BYTES="$(file_size_bytes "$DUMP_FILE")"
COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf 'unknown')"
TREE_STATE="clean"
if [[ -n "$(git -C "$REPO_ROOT" status --short 2>/dev/null || true)" ]]; then
  TREE_STATE="dirty"
fi
PG_DUMP_VERSION="$(pg_dump --version)"

printf '%s  %s\n' "$CHECKSUM" "$(basename "$DUMP_FILE")" > "$CHECKSUM_FILE"

cat > "$MANIFEST_FILE" <<EOF
Car Doc public-schema baseline backup
Created UTC: $STAMP
Repository: $REPO_ROOT
Git commit: $COMMIT
Git working tree: $TREE_STATE
Database target: $TARGET
Protected schema: public
Dump filename: $(basename "$DUMP_FILE")
Dump format: PostgreSQL custom
Dump size bytes: $SIZE_BYTES
SHA-256: $CHECKSUM
PostgreSQL client: $PG_DUMP_VERSION
Row-count file: $(basename "$ROW_COUNTS")
Archive listing: $(basename "$ARCHIVE_LIST")
Migration status: $(basename "$MIGRATION_STATUS_FILE")
Credentials stored: no

Redacted backup command:
pg_dump --dbname=[REDACTED DIRECT_URL] --format=custom --no-owner --no-privileges --schema=public --file=[BACKUP_FILE]

Restore guidance:
Use scripts/db/restore-public-db.sh with the exact confirmation token.
The restore targets only the public schema. Supabase Auth users and stored file objects are not included.
EOF

chmod 600 "$DUMP_FILE" "$ARCHIVE_LIST" "$ROW_COUNTS" "$CHECKSUM_FILE" "$MANIFEST_FILE" "$MIGRATION_STATUS_FILE"

"$SCRIPT_DIR/verify-public-db-backup.sh" "$BACKUP_DIR"

printf '\nBackup created successfully:\n%s\n' "$BACKUP_DIR"
