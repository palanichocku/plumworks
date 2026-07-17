# Prisma migration notes

This schema is the initial PostgreSQL model for PlumWorks. No database migration
has been created or applied yet.

## Conventions

- All application-owned tables use UUID primary keys and snake_case database
  names.
- Every business record is scoped to a shop. Application queries and future
  Supabase Row Level Security policies must always enforce `shop_id`.
- Legacy identifiers are nullable strings so formatting and leading zeroes can
  be preserved. Tenant-scoped constraints prevent duplicates within a shop,
  while standalone indexes support import reconciliation.
- Vehicles do not duplicate `legacy_custno`; their legacy customer identity is
  resolved through the required customer relation. This avoids two sources of
  truth.
- Quantities and hours use fixed-precision decimals. Currency uses
  `Decimal(12, 2)`; monetary calculations should stay decimal-based in
  application code.
- Customer display-name search currently uses a B-tree index. If production
  requirements include case-insensitive contains or fuzzy matching, add a
  PostgreSQL trigram index in reviewed migration SQL.

## Before applying the first migration

Review the generated SQL, enable Row Level Security on tenant-owned tables, and
add explicit Supabase policies before exposing data through the API. Use the
direct database connection for migration commands and the pooled connection for
application traffic.
