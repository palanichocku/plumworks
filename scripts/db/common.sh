#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

file_size_bytes() {
  local path="$1"
  if stat -f%z "$path" >/dev/null 2>&1; then
    stat -f%z "$path"
  else
    stat -c%s "$path"
  fi
}

permission_mode() {
  local path="$1"
  if stat -f%Lp "$path" >/dev/null 2>&1; then
    stat -f%Lp "$path"
  else
    stat -c%a "$path"
  fi
}

sha256_file() {
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    die "Neither shasum nor sha256sum is available."
  fi
}

load_direct_url() {
  local env_file="$1"
  [[ -f "$env_file" ]] || die "Environment file not found: $env_file"
  require_command node

  local value
  value="$(node --env-file="$env_file" -e 'process.stdout.write(process.env.DIRECT_URL || "")')"
  [[ -n "$value" ]] || die "DIRECT_URL is missing from $env_file"
  printf '%s' "$value"
}

redacted_db_target() {
  local db_url="$1"
  node - "$db_url" <<'NODE'
const raw = process.argv[2];
try {
  const u = new URL(raw);
  const db = u.pathname.replace(/^\//, "") || "(default database)";
  process.stdout.write(`${u.hostname}:${u.port || "5432"}/${db}`);
} catch {
  process.stdout.write("[unable to parse target]");
}
NODE
}

write_exact_public_row_counts() {
  local db_url="$1"
  local output_file="$2"

  require_command psql
  psql \
    --dbname="$db_url" \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    > "$output_file" <<'SQL'
SELECT format(
  'SELECT %L || E''\t'' || count(*)::text FROM %I.%I;',
  schemaname || '.' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
SQL
}

sanitize_label() {
  local label="$1"
  printf '%s' "$label" | tr -cs 'A-Za-z0-9._-' '-'
}
