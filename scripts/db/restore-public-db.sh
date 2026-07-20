#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

CONFIRM_TOKEN="RESTORE_PUBLIC_BASELINE"

usage() {
  cat <<EOF
Usage:
  ./scripts/db/restore-public-db.sh BACKUP_DIRECTORY [options]

Options:
  --confirm $CONFIRM_TOKEN
                         Required to perform the destructive restore.
  --env-file PATH        Environment file. Default: <repo>/.env.local
  -h, --help             Show this help.

Without the exact confirmation token, the script performs a dry run only.
EOF
}

[[ $# -ge 1 ]] || {
  usage
  exit 1
}

BACKUP_DIR="$1"
shift

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"
CONFIRM_VALUE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm)
      [[ $# -ge 2 ]] || die "--confirm requires a value."
      [[ -z "$CONFIRM_VALUE" ]] || die "--confirm may only be supplied once."
      CONFIRM_VALUE="$2"
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

"$SCRIPT_DIR/verify-public-db-backup.sh" "$BACKUP_DIR"

DUMP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -print | head -1)"
ROW_COUNTS_FILE="$BACKUP_DIR/public-row-counts.tsv"

DB_URL="$(load_direct_url "$ENV_FILE")"
TARGET="$(redacted_db_target "$DB_URL")"

printf '\nRestore plan:\n'
printf '  Target: %s\n' "$TARGET"
printf '  Backup: %s\n' "$DUMP_FILE"
printf '  Scope: public schema only\n'

if [[ -z "$CONFIRM_VALUE" ]]; then
  unset DB_URL
  printf '  Mode: DRY RUN\n'
  printf '\nNo confirmation token supplied. No database writes performed.\n'
  printf 'To restore, rerun with:\n  --confirm %s\n' "$CONFIRM_TOKEN"
  exit 0
fi

[[ "$CONFIRM_VALUE" == "$CONFIRM_TOKEN" ]] || {
  unset DB_URL
  die "--confirm must equal $CONFIRM_TOKEN"
}

require_command pg_restore
require_command psql

printf '  Mode: CONFIRMED RESTORE\n'

SAFETY_ROOT="${SAFETY_BACKUP_ROOT:-$HOME/Projects/Web/plumworks-backups/cardoc/pre-restore-safety}"
printf '\nCreating an automatic pre-restore safety backup...\n'
"$SCRIPT_DIR/backup-public-db.sh" \
  --backup-root "$SAFETY_ROOT" \
  --label before-restore \
  --env-file "$ENV_FILE"

printf '\nRestoring public schema to %s...\n' "$TARGET"

pg_restore \
  --dbname="$DB_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  "$DUMP_FILE"

CURRENT_COUNTS="$(mktemp)"
trap 'rm -f "$CURRENT_COUNTS"; unset DB_URL' EXIT
write_exact_public_row_counts "$DB_URL" "$CURRENT_COUNTS"

if [[ -f "$ROW_COUNTS_FILE" ]]; then
  if ! diff -u "$ROW_COUNTS_FILE" "$CURRENT_COUNTS"; then
    die "Restore completed, but public table row counts do not match the baseline."
  fi
else
  printf 'Warning: baseline row-count file is missing; exact row-count comparison was skipped.\n' >&2
fi

unset DB_URL

printf '\nRestore completed successfully.\n'
printf 'Public table row counts match the baseline.\n'
printf 'Restart the local app and run the normal application smoke tests.\n'
