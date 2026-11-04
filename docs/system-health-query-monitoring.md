# System Health query monitoring — DEV pilot

This is a **DEV-only** incremental-monitoring pilot. It does **not** alter application queries, reset PostgreSQL statistics, or read/write customer tables. It captures bounded copies of existing PostgreSQL `pg_stat_statements` counters, and compares snapshots to measure **new executions only**.

## Deployment order

1. Merge the feature to `dev`; no Production migration or deployment.
2. From a trusted local checkout with `.env.development.local` pointing to the verified DEV Supabase project, run `npm run db:dev:status` and `npm run db:dev:migrate` using the existing DEV guard. The migration creates `system_health_query_snapshots` and `system_health_query_samples`.
3. Open DEV **Admin → System Health** and click **Capture DEV sample** once. This establishes a new baseline; it deliberately ignores historical Nov 3 cutover executions.
4. Run ordinary read-only DEV app navigation. After at least five minutes, click **Capture DEV sample** again and refresh.
5. Verify: only new calls between the two captures are counted; old seven-call DELETEs are not active. Newly executed shop-wide bulk DELETEs (if any) appear in the separate maintenance panel.
6. Missing migration or statistics permission shows **Collection unavailable**, never a false green result.

## Scheduled operation

DEV Preview does not run Vercel native cron. The optional `POST /api/internal/system-health/query-snapshot` endpoint accepts `Authorization: Bearer <SYSTEM_HEALTH_COLLECTOR_TOKEN>` and **only works in Vercel Preview**. Configure a strong random secret **only in DEV Preview**, and, after manual validation, invoke that endpoint from a trusted hourly scheduler (e.g. a separate Checkly API check with the secret configured as a locked check-level secret). Do **not** repurpose or modify the existing Checkly Critical User Journey.

Until a scheduler is actually configured, the dashboard explicitly labels the data as manual samples. No automatic samples are promised.

## Caveats and safety

- The window is the exact time between the oldest and latest available samples from the last 24h—not a claim of full 24h coverage.
- No baseline sample can reconstruct past Nov 3/Nov 4 activity.
- `pg_stat_statements` counters can reset; snapshots with different reset timestamps are rejected.
- Query patterns absent from the baseline are not backfilled with invented deltas.
- Classification is **heuristic** because app and maintenance scripts may use the same Postgres role.
- Rows are bounded to 500 query patterns per sample; this is a monitoring aid, not comprehensive tracing.
- Samples are retained 30 days; query text is normalized by PostgreSQL. Access is server-side only and the tables have no `anon` or `authenticated` grants.
- The on-page capture action requires Admin permission and is disabled in Production.
- No sample collection occurs on normal Repair Order, Invoice, or other shop route requests.
- Production promotion requires separate approval, migration review, and a production-specific scheduler/token.
