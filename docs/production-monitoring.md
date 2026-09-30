# Car Doc monitoring (Stage 1A)

This is a read-only browser and database health check. `/api/health` requires `Authorization: Bearer <MONITOR_HEALTH_TOKEN>` in every environment. It runs `SELECT 1` through the existing Prisma client and returns only status, rounded timings, timestamp, and a short version. HTTP 200 means the database check passed, 503 means it failed, and 401 means the token is missing or incorrect. Responses use `Cache-Control: no-store`.

## Local development

Start the existing guarded dev server with `npm run dev`; it validates the `plumworks-dev` target. Point `MONITOR_BASE_URL` at `http://127.0.0.1:3000`. Set `MONITOR_HEALTH_TOKEN` on the app server and the smoke process. Set `MONITOR_USER_EMAIL` and `MONITOR_USER_PASSWORD` for an existing dev account with read access to the listed routes. No credentials are stored in this repository.

Install dependencies with `npm install`, then install Chromium with `npx playwright install chromium`. Put the monitoring token, login, and report recipient in ignored `.env.development.local`. Run `npm run monitor:dev:smoke`, followed by `npm run monitor:dev:report` to print a clearly labeled development report. These dev commands validate the configured development project and require `http://localhost:3000`; the smoke run writes `artifacts/monitoring/result.json`, which is ignored by Git. Run `npm run monitor:dev:send` once to email a DEV / Stage 1A validation report using the existing Resend transport, `MONITOR_REPORT_EMAIL`, `RESEND_API_KEY`, and `TRANSACTIONAL_EMAIL_FROM`. The two email transport values can be read from the existing ignored `.env.local` if they are not in the dev file. The email contains only fixed check names, status, and timings. The generic `monitor:smoke` and `monitor:report -- --send` commands remain available for the future workflow. `MONITOR_HEARTBEAT_URL` is optional for the future workflow and is disabled by the dev wrapper. The endpoint token, credentials, and heartbeat URL are never included in reports.

The browser only visits public and authorized app pages. Its sole form submission is the existing login form. It does not submit public leads, mutate shop data, send customer email, or capture customer page screenshots/traces. Reports are visited only when the authenticated navigation grants access. Failures are recorded with fixed, sanitized messages. A JUnit summary is uploaded only after a failed GitHub run. Performance thresholds in `src/lib/monitoring/report.ts` are generous warnings; failed page loads and timeouts are failures.

## Dedicated DEV monitoring account

The `MONITOR` membership role has only `view_dashboard` and `view_marketing_leads`. It is shown in the staff list but cannot be assigned through staff invitations or the normal role controls. Use the dedicated `plumservice-dev@plumworksapp.com` account in development.

Set `MONITOR_USER_EMAIL=plumservice-dev@plumworksapp.com` and `MONITOR_USER_PASSWORD` in ignored `.env.development.local`. For Auth creation, also set the **plumworks-dev** `SUPABASE_SECRET_KEY` there. Never use a production key. Run `npm run monitor:dev:setup` for a read-only dry run. After verifying the plan, run `npm run monitor:dev:setup -- --confirm CREATE_DEV_PLUMSERVICE` to create or reuse the confirmed Supabase password user and create its MONITOR membership in the single verified dev shop. The script validates the existing development target, never sends an invitation, refuses to repurpose an unrelated Auth user or membership, and is safe to rerun. It prints no credentials and only a redacted Auth UUID.

## Separate production account preparation

Production account setup uses only the fixed, ignored `.env.production.monitor.local` file. It does not read `.env.development.local` or trust exported database/Supabase variables. Supply the production `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `MONITOR_USER_EMAIL=plumservice-prod@plumworksapp.com`, and `MONITOR_USER_PASSWORD` there. The command checks that both database URLs and the Supabase API URL identify the approved production project, rejects the DEV project, and strips ambient credentials before any lookup. No values belong in tracked files.

After production code deployment and the MONITOR migration are verified, `npm run monitor:prod:setup` will show a read-only plan. A separate, later authorized step may use `npm run monitor:prod:setup -- --confirm CREATE_PROD_PLUMSERVICE`. The confirmation creates or reuses one confirmed password Auth user and one MONITOR shop membership; it sends no invitation or verification email and refuses to alter ordinary staff memberships. Do not run either production setup mode during the Stage 1B code promotion before the account-creation checkpoint.

## Manual workflow and future setup

The GitHub workflow is `workflow_dispatch` only. After secrets are configured and production use is approved later, it installs from the lockfile, runs Chromium smoke checks, sends the report even when checks fail, uploads the sanitized JSON, and fails the job on a real health failure. Expected secrets are `MONITOR_BASE_URL`, `MONITOR_HEALTH_TOKEN`, `MONITOR_USER_EMAIL`, `MONITOR_USER_PASSWORD`, `MONITOR_REPORT_EMAIL`, `RESEND_API_KEY`, `TRANSACTIONAL_EMAIL_FROM`, and optional `MONITOR_HEARTBEAT_URL`. No secrets are created by this stage.

After validation, a daily schedule can be added to the workflow using `cron: '0 6 * * *'` with `timezone: 'America/Detroit'`. It is intentionally disabled now. An external monitor can later request `GET <production-origin>/api/health` with the bearer header above; expect 200, 503, or 401 as described. No Better Stack account setup is included here.
