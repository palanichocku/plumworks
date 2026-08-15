#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
[[ $# -ge 1 ]] || die "Usage: verify-public-db-backup.sh BACKUP_DIRECTORY [--env-file PATH] [--shop-id UUID]"
BACKUP_DIR="$1"; shift
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"; SHOP_ID=""
while [[ $# -gt 0 ]]; do case "$1" in --env-file) ENV_FILE="$2"; shift 2;; --shop-id) SHOP_ID="$2"; shift 2;; *) die "Unknown argument: $1";; esac; done
require_command node; require_command pg_restore
DB_URL="$(load_direct_url "$ENV_FILE")"; export DIRECT_URL="$DB_URL"
args=(verify --directory "$BACKUP_DIR"); [[ -z "$SHOP_ID" ]] || args+=(--shop-id "$SHOP_ID")
node "$SCRIPT_DIR/public-db-backup.mjs" "${args[@]}"
unset DIRECT_URL DB_URL
printf 'Authoritative backup verification passed.\n'
