#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/db/verify-public-db-backup.sh BACKUP_DIRECTORY
EOF
}

[[ $# -eq 1 ]] || {
  usage
  exit 1
}

BACKUP_DIR="$1"
[[ -d "$BACKUP_DIR" ]] || die "Backup directory not found: $BACKUP_DIR"

require_command pg_restore

DUMP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -print | head -1)"
[[ -n "$DUMP_FILE" ]] || die "No .dump file found in $BACKUP_DIR"

CHECKSUM_FILE="$BACKUP_DIR/sha256.txt"
[[ -f "$CHECKSUM_FILE" ]] || die "Missing checksum file: $CHECKSUM_FILE"

EXPECTED="$(awk 'NR==1 {print $1}' "$CHECKSUM_FILE")"
ACTUAL="$(sha256_file "$DUMP_FILE")"
[[ "$EXPECTED" == "$ACTUAL" ]] || die "Checksum mismatch. Expected $EXPECTED, got $ACTUAL"

TEMP_LIST="$(mktemp)"
trap 'rm -f "$TEMP_LIST"' EXIT
pg_restore --list "$DUMP_FILE" > "$TEMP_LIST"

# pg_restore list lines are whitespace-delimited, for example:
# 123; 1259 45678 TABLE public invoices postgres
# 456; 0    45678 TABLE DATA public invoices postgres
TABLE_COUNT="$(
  awk '$4 == "TABLE" && $5 == "public" { count++ } END { print count + 0 }' "$TEMP_LIST"
)"
TABLE_DATA_COUNT="$(
  awk '$4 == "TABLE" && $5 == "DATA" && $6 == "public" { count++ } END { print count + 0 }' "$TEMP_LIST"
)"

[[ "$TABLE_COUNT" -gt 0 ]] || die "Archive does not contain public table definitions."
[[ "$TABLE_DATA_COUNT" -gt 0 ]] || die "Archive does not contain public table data."

DIR_MODE="$(permission_mode "$BACKUP_DIR")"
FILE_MODE="$(permission_mode "$DUMP_FILE")"
SIZE_BYTES="$(file_size_bytes "$DUMP_FILE")"

if [[ "$DIR_MODE" != "700" ]]; then
  printf 'Warning: backup directory permissions are %s; expected 700.\n' "$DIR_MODE" >&2
fi
if [[ "$FILE_MODE" != "600" ]]; then
  printf 'Warning: dump permissions are %s; expected 600.\n' "$FILE_MODE" >&2
fi

printf 'Backup verification passed.\n'
printf 'Directory: %s\n' "$BACKUP_DIR"
printf 'Dump: %s\n' "$DUMP_FILE"
printf 'Size: %s bytes\n' "$SIZE_BYTES"
printf 'SHA-256: %s\n' "$ACTUAL"
printf 'Public table definitions: %s\n' "$TABLE_COUNT"
printf 'Public table-data entries: %s\n' "$TABLE_DATA_COUNT"
printf 'Directory permissions: %s\n' "$DIR_MODE"
printf 'Dump permissions: %s\n' "$FILE_MODE"
