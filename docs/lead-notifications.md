# Website lead notifications

New Contact, Appointment and Drop-Off form submissions create their MarketingLead and, when enabled, one MarketingLeadNotification in the same transaction. No historical leads are backfilled. Call-click tracking retains its existing behavior and does not generate a form-submission alert.

Shop Settings has independent in-app and email switches, both defaulting to true. Notification addresses are trimmed, lowercased, validated on the server and deduplicated for delivery. When email is enabled and both database addresses are blank, MARKETING_LEADS_NOTIFY_EMAIL remains the fallback. Disabling email skips delivery even when the environment fallback is set. In-app settings do not affect email.

Email delivery runs after the database transaction commits, through the existing Resend sender. Failure cannot roll back the lead or change its successful public-form response. Delivery failures are logged without customer content. This V1 does not add an email retry queue.

A single AppShell notification provider shares its state with the bell, desktop/mobile Leads navigation badges, and lead read controls. Navigation badges use the current user’s unread notification count, never the number of NEW leads. The provider owns the only poller. The bell shows the latest 20 alerts and a total unread count. It polls every 20 seconds while visible, refreshes on focus and visibility return, and suppresses repeated toasts using sessionStorage scoped to the shop/user. Up to three new alerts display individual 15-second toasts; additional arrivals display a summary. A failed refresh is indicated in the bell/panel, with automatic retry. Notification reads are per user and do not change lead status.

Leads is an operational workspace at /leads, with the same lead card and management action used at /leads/[id]. OWNER, ADMIN and STAFF receive view_marketing_leads and manage_marketing_leads permissions, including scheduling and internal notes. Shop Settings and other Admin functions retain edit_shop_settings permission; STAFF does not receive it. The old /admin/leads bookmark redirects to /leads before the Admin layout runs, preserving query parameters. The Leads tab is removed from Admin. An existing ShopMembership row is the current access signal; this schema has no active/inactive membership flag.

New tables are server-only, with RLS enabled and direct anon/authenticated access revoked. Composite foreign keys tie notifications to leads in the same shop and read records to both the notification and the shop membership. Server actions derive shop and user identifiers from authenticated membership, never browser-supplied shop IDs. Deleting a membership also removes that membership's read records.

The main navigation order is Repair Orders, Leads, Invoices, Customers, Vehicles, Website, Dashboard, Reports, Admin, Help, Accounts Receivable, subject to the existing module/permission filters. Dashboard New Leads and the Leads workspace share a shop-scoped operational-lead predicate. It excludes only Contact call-click tracking records with the fixed system message “Visitor clicked Call Now”; legitimate Contact, Appointment, and Drop-Off leads count regardless of null or historical message content. The NEW count additionally requires status=NEW. Call-click rows remain stored for analytics but are excluded from operational list/status views and detail lookups. The Dashboard count is available to lead-viewing users and links to /leads?status=NEW. Owner emails say “View Leads in PlumWorks” and link to /leads. Notification links still open /leads/[id], where users can manage the lead directly. Viewing the list or saving a lead does not mark notifications read; the explicit read controls and bell act only for the current user.

This operational-navigation follow-up does not change the Prisma schema or the previously created migration.

## Release procedure — not executed

1. Review the additive migration `prisma/migrations/20260921120000_add_marketing_lead_notifications/migration.sql`. Validate it against a separate non-production database and test with synthetic leads and two users before production rollout. Do not point that rehearsal at production.
2. Preserve existing Vercel Production variables `RESEND_API_KEY`, `TRANSACTIONAL_EMAIL_FROM` and `MARKETING_LEADS_NOTIFY_EMAIL`. Keep `NEXT_PUBLIC_SITE_URL=https://www.subbuscardoc.com`. No new environment variable is required.
3. After deployment approval and the normal database backup, use the release environment's production **direct** database connection for Prisma. With `DIRECT_URL` securely injected, run `npx prisma migrate status`, confirm the expected pending migration set, then `npx prisma migrate deploy`. This deploy command applies all pending migrations, so stop if unexpected migrations are pending. The migration creates defaults and empty tables; it does not insert historical notifications.
4. Generate the Prisma client (`npx prisma generate`) and deploy the reviewed application build to Vercel through the normal release workflow. The migration must finish before this version serves traffic: the new code selects the new settings columns. Existing code can continue using the expanded schema during the migration/deployment interval.
5. Check the new table RLS flags and confirm anon/authenticated have no table privileges. Confirm the application can read settings and notification state using its server database role.
6. In Admin → Shop Settings → Lead Notifications, verify both switches and the intended owner email recipients. Blank database recipients deliberately retain the previous environment email behavior.
7. Submit explicitly labeled synthetic Contact, Appointment and Drop-Off requests. Confirm persisted leads, one notification per lead, expected emails and links, and the unchanged form success response. Check STAFF can review and manage leads on /leads and /leads/[id] while Admin remains restricted. Confirm bell and desktop/mobile Leads badges stay synchronized. With two users, verify independent unread badges, individual/all-read actions, navigation persistence, a hidden-tab return, and no repeated toasts on subsequent polls. Confirm the existing scheduling email still works.

If an application rollback is needed, retain the additive database migration and deploy the previous application version. Do not delete leads or notifications as part of a code rollback. Restore the reviewed version to resume new in-app notification creation.

## Local checks

- `npm run prisma:validate`
- `npm run prisma:generate`
- `node --test tests/operational-leads.test.mjs tests/marketing-lead-notifications.test.mjs tests/lead-notification-center.test.mjs tests/marketing-lead-attribution.test.mjs scripts/app-shell-navigation.test.mjs tests/business-profile.test.mjs tests/configurable-audit-logging.test.mjs`
- `npm run test:seo`
- `node --test tests/cardoc-legacy-redirects.test.mjs tests/cardoc-canonical-host.test.mjs tests/marketing-robots.test.mjs`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

Focused tests execute the implementation with fake database/email/browser boundaries. They do not apply migrations, call Resend, or modify production data. Database integration and authenticated visual QA require a separate migrated test environment.

## Operational Leads follow-up validation

- 65 focused operational lead, notification, navigation, attribution, business-profile and permission regression tests passed.
- 53 marketing/SEO regression tests and 38 canonical-host/legacy-redirect/robots tests passed.
- TypeScript and the production build passed. All 25 changed TypeScript/TSX/test files passed ESLint with zero warnings.
- Full-project lint still reports the pre-existing `react-hooks/set-state-in-effect` error at `src/app/(app)/admin/app-settings/page.tsx:37`. That file was not modified.
- `tests/dashboard-summary.test.mjs`: 9 passed, 2 existing assertions failed. Both failures were reproduced against HEAD before the follow-up: the test counts every `label:` in the expanded Dashboard instead of just summary cards (9 versus 5), and its invoice query regex does not allow the existing void-status exclusion. Only lead-destination assertions were updated in this follow-up.
- The Prisma schema and the previously created notification migration are byte-for-byte unchanged from the start of this follow-up. No migration or production mutation was executed.

Follow-up file manifest (does not include unchanged files from the original notification implementation):

- `docs/lead-notifications.md`
- `next.config.ts`
- `scripts/app-shell-navigation.test.mjs`
- `src/app/(app)/admin/admin-tabs.tsx`
- `src/app/(app)/admin/leads/actions.ts`
- `src/app/(app)/admin/leads/page.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/leads/[id]/page.tsx`
- `src/app/(app)/leads/actions.ts`
- `src/app/(app)/leads/manage-actions.ts`
- `src/app/(app)/leads/page.tsx`
- `src/components/app-navigation.tsx`
- `src/components/app-shell.tsx`
- `src/components/lead-notification-center.tsx`
- `src/components/lead-notification-provider.tsx`
- `src/components/lead-read-control.tsx`
- `src/components/marketing-lead-card.tsx`
- `src/lib/data/dashboard.ts`
- `src/lib/marketing-lead-notification-center.ts`
- `src/lib/marketing-lead-notifications.ts`
- `src/lib/marketing-lead-read-presentation.ts`
- `src/lib/permission-matrix.json`
- `src/lib/permissions.ts`
- `tests/dashboard-summary.test.mjs`
- `tests/lead-notification-center.test.mjs`
- `tests/marketing-lead-notifications.test.mjs`
- `tests/operational-leads.test.mjs`
