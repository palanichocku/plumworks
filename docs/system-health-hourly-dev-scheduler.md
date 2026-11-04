# DEV hourly query-performance collection

DEV uses Vercel **Preview**, so native Vercel cron is not an option (those invoke Production only). Keep existing Checkly **Car Doc Critical User Journey** unchanged.

## Activation (once; requires Checkly and Vercel account access)

1. Generate one strong random token locally: `openssl rand -hex 32`. Do not commit it or paste it into ChatGPT.
2. Vercel project `plumworks-cardoc` → Settings → Environment Variables: add **`SYSTEM_HEALTH_COLLECTOR_TOKEN`** as a **Preview** secret. Redeploy the `dev` branch after adding it. Do not add this token to Production.
3. Checkly → New → **API check** (separate from the existing Car Doc Critical User Journey):
   - Name: `PlumWorks DEV – Hourly SQL Snapshot`
   - Frequency: **Every 1 hour**, one location (e.g. Ohio)
   - Method: **POST**
   - URL: `https://dev.subbuscardoc.com/api/internal/system-health/query-snapshot`
   - Header: `Authorization: Bearer {{DEV_QUERY_MONITOR_TOKEN}}`
   - Check-level **environment secret**: `DEV_QUERY_MONITOR_TOKEN`, using the exact same value as the Vercel Preview secret
   - No request body, cookies, or extra headers needed
   - Assert HTTP **200** and JSON path `$.status` equals `captured`
4. Save and run this **new** check manually. It should report `{ "status": "captured", "message": "Query statistics snapshot captured." }`. A check run within five minutes of a prior manual sample returns `{ "status": "throttled" }`—this is expected and not a collector outage. Retry after five minutes.
5. Verify **DEV → Admin → System Health** shows the new latest-sample timestamp; check the next two hourly Checkly runs and ensure the longest sample gap stays near 60 minutes.

## Security and isolation

The endpoint is **POST-only**, returns 404 outside Vercel Preview, requires timing-safe bearer authentication, writes bounded PostgreSQL statistics to separate platform-only tables, and never touches customer data. Never expose the token in a query string or log. Configure Checkly's header with a locked/secret environment variable, not a literal token.

If Checkly cannot access the deployment because Preview Deployment Protection is enabled, do not disable protection globally. Configure an approved Checkly access method or adjust only the intended DEV deployment access controls.

## Status interpretation

- **Last sample** and **sample count** describe actual stored captures, independent of whether a scheduled check has been configured.
- **Observed span** is not a guarantee of continuous coverage; the dashboard flags gaps above 90 minutes and partial 24-hour coverage.
- **Stale** means no sample in 2½ hours; do not interpret historical data as current healthy.
- The manual `Capture DEV sample` button remains as a fallback.
- A separate, approved Production rollout would need its own migration and scheduler. Do not promote this DEV endpoint's configuration to Production automatically.
