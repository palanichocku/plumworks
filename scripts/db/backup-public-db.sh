#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/Projects/Web/plumworks-backups/cardoc/client-testing-baseline}"
LABEL="baseline"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"
SHOP_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-root) BACKUP_ROOT="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --shop-id) SHOP_ID="$2"; shift 2 ;;
    -h|--help) printf '%s\n' 'Usage: backup-public-db.sh [--backup-root PATH] [--label NAME] [--env-file PATH] [--shop-id UUID]'; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done
require_command node; require_command pg_dump; require_command pg_restore
LABEL="$(sanitize_label "$LABEL")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/${LABEL}-${STAMP}"
DB_URL="$(load_direct_url "$ENV_FILE")"
export DIRECT_URL="$DB_URL"
args=(create --directory "$BACKUP_DIR")
[[ -z "$SHOP_ID" ]] || args+=(--shop-id "$SHOP_ID")
node "$SCRIPT_DIR/public-db-backup.mjs" "${args[@]}"
unset DIRECT_URL DB_URL
printf '\nAuthoritative public-schema backup created and verified:\n%s\n' "$BACKUP_DIR"
