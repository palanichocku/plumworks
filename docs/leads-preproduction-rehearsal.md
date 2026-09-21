# Leads and notifications: pre-production rehearsal

Date: 2026-09-21. Recommendation: **READY FOR PRODUCTION**, with the existing unrelated lint/Dashboard test failures disclosed below. Execute the normal reviewed release process and the post-deployment checks; no production steps were performed during this rehearsal.

## Environment and boundaries

The configured isolated remote restore database was unavailable (its pooler could not find the test tenant). The rehearsal therefore used a disposable **local Supabase stack**, PostgreSQL 17.6, real Supabase Auth, three synthetic authenticated users, and synthetic business records. Database and Auth connections were restricted to loopback. No production database URL was used. The application launcher explicitly shadowed local environment settings and supplied only rehearsal credentials.

Production-mode Next.js ran on port 3107. Playwright drove installed Chrome on desktop and mobile viewports. All outbound browser requests were restricted to loopback. Resend requests were intercepted at the application's HTTP boundary, accepted only `@example.test` recipients, and captured locally. The real application's email composition and sending path ran; **external Resend acceptance and mailbox delivery were not tested**. Those remain immediate production smoke checks using an owner-approved recipient.

Evidence, scripts, logs, synthetic screenshots, and test-database snapshots are under `/private/tmp/cardoc-leads-rehearsal/`. That directory also contains local-only test credentials; do not publish or commit it. No private legacy/customer data was used.

The rehearsal application and local Supabase containers were stopped after verification. Synthetic database data was retained in the local Docker volume for review.

## Results

| # | Check | Result |
| --- | --- | --- |
| 1 | Migration | PASS. Applied the 41 baseline migrations, seeded synthetic existing data, confirmed exactly one pending migration, then applied `20260921120000_add_marketing_lead_notifications` locally. All 42 migrations are now applied. Prisma generation/validation passed; schema diff reports no difference. |
| 2 | Existing data | PASS. Immediately after migration, all 35 preexisting table snapshots matched, excluding only the four newly added Shop keys from comparison. Both settings default to true; both addresses default to null. No historical notifications. After browser testing, all 32 tables not intentionally changed by authentication/settings/audit activity still matched their baseline rows, including the five historical leads and financial/operational records. |
| 3 | Contact | PASS. Actual public form success, exactly one lead and one notification with correct shop/source/entered fields when enabled. |
| 4 | Appointment | PASS. Same guarantees; preferred date/time preserved. |
| 5 | Drop-Off | PASS. Same guarantees; in-app-disabled submission creates a lead without a notification and still sends its owner email. |
| 6 | Email | PASS at captured HTTP boundary. One address, two addresses, normalized duplicates, environment fallback, disabled email, and simulated Resend 500 exercised through public submissions. Disabled email suppresses fallback. Failure preserves the committed lead and successful public response. Subjects identify each source; body fields and `/leads` link are correct; no internal lead ID appears in the owner email. |
| 7 | Two-user state | PASS. OWNER and STAFF independently see the same unread alerts. Reading as OWNER reduces only that user's count without changing lead status. Changing NEW to CONTACTED leaves all read rows unchanged and STAFF unread. Mark all affects only the current user. |
| 8 | Navigation/badges | PASS. Exact requested desktop ordering; mobile Leads is visible. Bell and navigation counts match, hide at zero, and use one shared provider/poller. `/leads` and direct operational lead links work. |
| 9 | Bell/toast | PASS. Toast and bell open an editable operational lead. Real-time browser observation confirms toast expiry and no repeated toast on subsequent polls in the same session. Persistent unread state remains until read. |
| 10 | Inactivity | PASS. One request at approximately 20 seconds while visible; none across 60 seconds hidden. Visibility return and focus each trigger immediate refresh. A lead submitted while hidden produces the toast and both badges on return. Lifecycle tests use controlled browser clock/visibility events; toast expiry/repetition was separately verified with normal time. |
| 11 | OWNER | PASS. Authenticated Leads management and direct Admin destinations work. |
| 12 | ADMIN | PASS. Authenticated Leads and permitted direct Admin destinations work. |
| 13 | STAFF | PASS. Leads list/detail and scheduling/note/status management work. Direct Shop Settings, Staff, Data Tools, and Audit Log routes remain denied. No `edit_shop_settings` grant. Foreign-shop detail returns 404 and filtered list exposes no foreign lead. |
| 14 | Dashboard | PASS for feature behavior. New Leads still counts NEW business leads, excluding call-click tracking records, and links to `/leads?status=NEW`. The same two unrelated tests fail against both current code and pre-feature HEAD source. |
| 15 | Lint | Full `npm run lint`: one known existing `react-hooks/set-state-in-effect` error at `src/app/(app)/admin/app-settings/page.tsx:37`, zero warnings. That file was not changed. Targeted lint of rehearsal changes passes. |
| 16 | TypeScript | PASS: `npx tsc --noEmit`. |
| 17 | Production build | PASS: `npm run build` using isolated test configuration; repeated after the redirect correction. |
| 18 | Defects | One canonical-host defect discovered and fixed: an upstream port in `request.nextUrl` survived assignment of the canonical host. Explicitly clearing the port prevents `https://www.subbuscardoc.com:3107/...`. No Leads/notification defect found. |
| 19 | Rehearsal edits | `src/proxy.ts`: clear canonical URL port. `tests/cardoc-canonical-host.test.mjs`: execute proxy with an upstream port and assert exact 301 destination. This report is new. No notification schema/migration changes. Build-generated `next-env.d.ts` change was restored. |
| 20 | Recommendation | READY FOR PRODUCTION, with the documented existing baseline failures and external email-delivery limitation. Migration must precede serving the new application. |

Desktop navigation: Repair Orders → Leads → Invoices → Customers → Vehicles → Website → Dashboard → Reports → Admin → Help → Accounts Receivable. Permission filtering still applies.

The workspace and detail page share the existing management card/actions. Newest-first order, sources, five statuses, filtering, call/email links, service/vehicle/preferred time, scheduled time, internal note, and Save Lead were checked. STAFF scheduled an appointment through `/leads/[id]`; the customer confirmation email contained the saved date/time. `/admin/leads?status=NEW` redirected to `/leads?status=NEW`.

## Database/security evidence

- The four Shop columns, both notification tables, eight indexes on those tables, and four foreign keys were inspected in PostgreSQL.
- Unique lead notification and `(notification_id, user_id)` constraints were exercised; duplicates were rejected.
- Composite foreign keys rejected cross-shop notification/read references and reads for a user without membership.
- Both new tables have RLS enabled, no public policies, and no table privileges for `anon` or `authenticated`. Direct SQL under each role was denied. Access intentionally goes through authenticated, membership-scoped application server operations.
- Constraint-test writes were rolled back. Browser test records are synthetic and remain only in the disposable database.

## Test evidence

| Suite | Result |
| --- | --- |
| Focused lead/email/notification/navigation/permission regressions | 65 passed |
| Marketing SEO/content/attribution regressions (`npm run test:seo`) | 53 passed |
| Canonical/legacy redirects and robots | 39 passed, including the new upstream-port regression |
| Dashboard current code | 9 passed, 2 preexisting failures |
| Dashboard pre-feature HEAD source | Same 9 passed, same 2 failures |
| Authenticated production-mode browser/database rehearsal | Passed the scenarios above |

The Dashboard failures are existing source-pattern assertions: a broad `label:` count expects five but finds nine, and an invoice query regex omits the existing void-status exclusion. They are not introduced by the Leads work. No unrelated Dashboard code or tests were altered during this rehearsal.

The final running-server check confirmed the exact one-hop legacy redirect and canonical redirect with query preservation after rebuilding. Two intermediate browser-harness assertions were corrected without product changes: Node fetch did not preserve the intended Host override (replaced with native HTTP), and accelerated/hovered toast timing was replaced by normal-time observation with the pointer outside the toast.

## Ordered release actions — NOT EXECUTED

1. Review the complete local feature diff, the migration, and the two rehearsal correction files. Retain the normal production backup/PITR evidence and previous Vercel deployment for rollback. Acknowledge the existing baseline test/lint failures in release review. Keep temporary rehearsal credentials and artifacts out of Git.

2. Commit only the reviewed files. From the repository root, the current feature/rehearsal file set can be staged explicitly:

```bash
git diff --check
git status --short
git add -- \
  next.config.ts prisma/schema.prisma \
  prisma/migrations/20260921120000_add_marketing_lead_notifications/migration.sql \
  scripts/app-shell-navigation.test.mjs \
  'src/app/(app)/admin/admin-tabs.tsx' \
  'src/app/(app)/admin/leads/actions.ts' 'src/app/(app)/admin/leads/page.tsx' \
  'src/app/(app)/admin/shop-settings/actions.ts' 'src/app/(app)/admin/shop-settings/page.tsx' \
  'src/app/(app)/dashboard/page.tsx' 'src/app/(app)/layout.tsx' 'src/app/(app)/leads' \
  'src/app/(marketing)/lead-actions.ts' \
  src/components/app-navigation.tsx src/components/app-shell.tsx \
  src/components/lead-notification-center.tsx src/components/lead-notification-provider.tsx \
  src/components/lead-notification-settings-form.tsx src/components/lead-read-control.tsx \
  src/components/marketing-lead-card.tsx src/lib/data/dashboard.ts \
  src/lib/marketing-lead-notifications.ts src/lib/marketing-lead-notification-center.ts \
  src/lib/marketing-lead-notification-settings.ts src/lib/marketing-lead-read-presentation.ts \
  src/lib/marketing-lead-submission.ts src/lib/permission-matrix.json src/lib/permissions.ts \
  src/proxy.ts tests/cardoc-canonical-host.test.mjs tests/dashboard-summary.test.mjs \
  tests/lead-notification-center.test.mjs tests/marketing-lead-notifications.test.mjs \
  tests/operational-leads.test.mjs docs/lead-notifications.md docs/leads-preproduction-rehearsal.md
git diff --cached --stat
git diff --cached --check
git diff --cached
git commit -m "Add operational Leads workspace and persistent lead notifications"
git rev-parse HEAD
```

Record that SHA. Follow the repository's normal staging/release review process for that exact commit. Do not push to an automatically deploying production branch before the production migration below has completed.

3. In the authorized release shell, securely inject the **verified Car Doc production** `DIRECT_URL` from the secret store. Do not copy rehearsal credentials, print database secrets, or use `migrate dev`/`db push`. From the reviewed release checkout:

```bash
npx prisma validate
npx prisma migrate status
```

Confirm that only `20260921120000_add_marketing_lead_notifications` is pending, with no failed/divergent migrations. A pending-status exit is expected before deployment. Stop if the pending set differs.

4. After release approval and backup verification, apply the additive migration before application deployment:

```bash
npx prisma migrate deploy
npx prisma migrate status
npx prisma generate
```

Confirm all 42 migrations are applied. Confirm the new tables are empty, existing Shop defaults are true/true/null/null, RLS is enabled, and no historical notifications were inserted. Do not run any seed or legacy import command.

5. Deploy the recorded commit to the **existing Car Doc Vercel project serving `www.subbuscardoc.com`** through its normal release integration. If `main` is that project's configured production branch, the reviewed current branch can now be published with:

```bash
git push origin main
```

If automatic deployment is disabled, deploy that exact commit through the existing project's deployment workflow. Verify the deployment's Git SHA equals the recorded SHA before promoting/assigning production traffic. Preserve `NEXT_PUBLIC_SITE_URL=https://www.subbuscardoc.com`, Supabase production configuration, Resend settings, and the existing `MARKETING_LEADS_NOTIFY_EMAIL` fallback. Do not introduce a Vercel domain-level redirect. Record deployment ID and SHA.

6. Immediately smoke-test HTTP behavior:

```bash
curl -sSI https://www.subbuscardoc.com/
curl -sSI https://subbuscardoc.com/
curl -sSI 'https://subbuscardoc.com/contact?utm_source=release-smoke'
curl -sSI https://subbuscardoc.com/Sterling-Heights-auto-brakes.html
curl -sS https://www.subbuscardoc.com/robots.txt
curl -sS https://www.subbuscardoc.com/sitemap.xml
```

Expect www root 200; apex root exact 301 to www root; ordinary redirect preserves query with no extra port; legacy brakes URL exact one-hop 301 to `https://www.subbuscardoc.com/services/brakes`. Robots must allow normal crawling, preserve internal exclusions, and reference `https://www.subbuscardoc.com/sitemap.xml`; sitemap URLs must use canonical www.

7. With owner-approved recipients and clearly labelled synthetic submissions, exercise Contact, Appointment, and Drop-Off once each. Confirm public success, one lead/notification each, and **actual owner mailbox delivery** with correct source and `/leads` link. Use two authorized staff accounts to check independent reads, status changes, the shared bell/navigation count, direct detail actions, return-from-inactivity toast, and STAFF Admin denial. Verify dashboard, customers, vehicles, repair orders, invoices, AR, and reports load. Confirm no unexpected errors in Vercel logs. Do not alter real customer or financial records for smoke testing.

If smoke testing fails, roll the application back to the previous deployment and retain the additive migration and all lead records. Do not drop notification tables or delete leads to roll back application code.
