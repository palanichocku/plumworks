# PlumWorks / Car Doc — Project Context

> Source snapshot: `palanichocku/plumworks`, `main` at `1a8d6a62a9c1c5bd61ed68c1e73ddf180949e87e` (2026-10-05). This document describes inspected source at that commit and explicitly labels operational history that was not independently checked against live services. Recheck the branch, deployment SHA, database migrations, and GitHub Project before acting. `CONTEXT_HANDOFF.md` is an older, August 17 snapshot, not a substitute for current code. Paths below are repository relative. No production data or secrets are included.

## 1. Project Overview & Product Vision

PlumWorks is a small-business operations SaaS; Car Doc LLC is its first automotive customer. A shop needs one place to receive public inquiries, identify the customer and vehicle, create and price repair work, finalize an invoice, collect multiple payments, track receivables, and reconcile historical sales. The public Car Doc marketing site and authenticated shop workspace share one Next.js application. The intended long-term product is reusable across business types, but `src/lib/business-profile.ts` currently returns only the automotive profile; it is **not** a finished multi-vertical product.

Typical workflow: a visitor uses `/contact`, `/appointment`, or `/drop-off` (or calls); a validated `MarketingLead` is stored and optionally creates an in-app notification and an email. Staff review `/leads?status=NEW`, contact/schedule/convert the lead, locate or create a Customer and Vehicle, and create a Draft/Open Repair Order. They add concerns, odometer, parts and labor, may use scoped customer/vehicle history, then finalize to an Invoice. The invoice preserves a numbered RO and document snapshots. Payments may be split among customer and insurance; recording the final payment closes the invoice and updates AR. Reports use sold/closed invoices, not merely opened ROs. Imported Shopman32 history remains searchable alongside native work.

Car Doc public routes: `/`, `/about`, `/services`, `/services/[slug]`, `/reviews`, `/photos`, `/coupons`, `/appointment`, `/contact`, `/drop-off`, `/privacy`. App routes include `/dashboard`, `/repair-orders`, `/invoices`, `/customers`, `/vehicles`, `/leads`, `/reports`, `/accounts-receivable`, `/admin`, `/help`, and `/search`. `/admin/leads` redirects to `/leads` in `next.config.ts`. Production public domain is `www.subbuscardoc.com`; product domain is `plumworksapp.com`. The repo's old README and some dated docs describe earlier stages; use current source for status.

## 2. Architecture & File Tree

- **Runtime:** Next.js `16.2.10` App Router, React/React DOM `19.2.4`, TypeScript `^5`, Node 24 in the health workflow. Styling is Tailwind CSS `^4` with `@tailwindcss/postcss`; UI is mostly custom JSX/CSS, despite the older `AGENTS.md` mentioning shadcn/ui. `react-hot-toast` powers notices; `mermaid` powers Help diagrams.
- **Server/data:** Server Components and Server Actions, Prisma CLI/client and `@prisma/adapter-pg` `^7.8.0`, `pg` `^8.22.0`, Supabase PostgreSQL. `src/lib/prisma.ts` creates an adapter-backed client from `DATABASE_URL`; `prisma.config.ts` uses `DIRECT_URL` for CLI migrations. Prisma client is generated into `src/generated/prisma` per `prisma/schema.prisma`.
- **Auth and permissions:** Supabase Auth via `@supabase/ssr` `^0.12.1`, `@supabase/supabase-js` `^2.110.3`, cookie handling in `src/proxy.ts` and `src/lib/supabase/{client,server,proxy,admin}.ts`. `src/lib/data/membership.ts` maps Auth UUID to `ShopMembership`; `src/lib/permissions.ts` and `src/lib/permission-matrix.json` enforce OWNER/ADMIN/STAFF/MONITOR permissions. The MONITOR role has read access appropriate for smoke checks.
- **Documents/email/hosting:** `@react-pdf/renderer` `^4.5.1` for PDFs; `resend` `^6.18.0` and `nodemailer` `^9.0.3` for notifications and document/report email. Vercel hosts the app/marketing pages; a separate Supabase project/database per client is the documented target (`docs/client-deployment-runbook.md`). DEV is `plumworks-dev`, production Car Doc is a distinct Supabase project. Marketing assets may be in the private client deployment/content repo, not the shared source. Browser smoke checks use Playwright `^1.63.0`.

Annotated map (key files, not every file):

```text
AGENTS.md                         Repository safety constraints; read before work
CONTEXT_HANDOFF.md                Dated historical handoff; check its dates
package.json, package-lock.json    Scripts and pinned/resolved packages
.env.example                      Baseline environment keys; monitoring keys are documented separately
prisma.config.ts                   Prisma CLI direct DB connection
prisma/schema.prisma               Authoritative model names, fields, keys, relations and enums
prisma/migrations/                 Applied migration history; inspect pending set before deployment
src/proxy.ts                       Auth cookie refresh and public/legacy route handling
src/app/(app)/layout.tsx           Authenticated shell and membership redirects
src/app/(app)/{dashboard,repair-orders,invoices,customers,vehicles,leads,reports,accounts-receivable,admin}/
                                  Page Server Components and colocated Server Actions
src/app/(marketing)/              Public pages and lead-actions.ts for three forms
src/app/(documents)/              Print document routes
src/app/api/health/route.ts        Token-gated database health check
src/app/api/lead-notifications/[id]/read/route.ts
                                  Per-user notification acknowledgement
src/app/api/marketing/call-click/route.ts
                                  Call-click attribution/analytics
src/components/app-shell.tsx       Workspace shell and sidebar markup
src/components/app-navigation.tsx  Menu ordering, badges, portal tooltips
src/components/sidebar-controls.tsx
                                  Browser-persisted collapse state
src/app/globals.css               RO workbench and sidebar breakpoint/layout rules
src/components/repair-order-{workspace,line-items,history-drawer,history-button}.tsx
                                  RO entry and scoped history UI
src/components/invoice-edit-workspace.tsx, invoice-payment-form.tsx
                                  Invoice editing and split-payment UI
src/components/lead-notification-provider.tsx, lead-notification-center.tsx
                                  Client polling, read behavior and toasts
src/lib/data/                    Shop-scoped Prisma reads for pages
src/lib/{repair-order-lifecycle,repair-order-totals,repair-order-void}.ts
                                  RO lifecycle/math/void policy
src/lib/{invoice-lifecycle,invoice-payments,invoice-void,invoice-snapshots}.ts
                                  Invoice/payment policy and snapshots
src/lib/{reportable-sales,daily-sales-aggregation,sales-report-period}.ts
                                  Sold-date predicates, arithmetic and date windows
src/lib/marketing-*.ts, src/lib/public-lead-*.ts
                                  Public content, validation, anti-abuse and notification flow
src/lib/business-profile.ts, src/lib/verticals/automotive/
                                  Single active vertical and terminology
src/lib/monitoring/              Health/report models and thresholds
monitoring/{health.spec.ts,login.ts}, playwright.monitor.config.ts
                                  Read-only browser smoke and login checks
scripts/{monitor-report.ts,monitor-heartbeat.ts,dev-database-command.mjs}
                                  Email/heartbeat and DEV DB guard
.github/workflows/cardoc-production-health.yml
                                  Manual production smoke job at this commit
scripts/legacy-*.mjs, scripts/db/, docs/cutover-runbook.md
                                  Guarded legacy migration, backup and rollback tooling
docs/{production-monitoring,public-lead-protection,lead-notifications}.md
                                  Operational notes; some stage/status text is dated
tests/, scripts/*.test.mjs       Focused regression tests
```

## 3. Data Model & State Management

`prisma/schema.prisma` maps singular Prisma models to snake-case PostgreSQL tables (`@@map`). Most row IDs are database-generated UUIDs (`gen_random_uuid()`); `shopId` scopes business rows. Important relationships and constraints:

| Tables / models | Keys and relationship | Operational meaning |
| --- | --- | --- |
| `shops` / `Shop` | UUID `id`; `nextRepairOrderNumber`; one-to-many to operational rows | Tenant identity, tax/labor/shop-supply settings and lead-notification switches/recipient emails. Separate project per client is intended. |
| `shop_memberships` / `ShopMembership` | UUID `id`, unique `(shopId,userId)`; `userId` is Supabase Auth UUID | Roles OWNER, ADMIN, STAFF, MONITOR. Authentication alone is insufficient; pages/actions require membership/permission. |
| `customers`, `customer_legacy_aliases`, `vehicles` | UUID PKs; Vehicle `customerId`; unique `(shopId,legacyCustno)` and `(shopId,legacyCarno)` | Archived historical identities and aliases preserve imported links. Historical Invoice customer must not be rewritten simply because Vehicle ownership changes. |
| `repair_orders`, `repair_order_parts`, `repair_order_labor`, `vendors` | UUID PKs; RO `customerId`, `vehicleId`; child rows `repairOrderId`; unique `(shopId,repairOrderNumber)` and `(shopId,legacyRoNo)` | Draft/Open/void lifecycle, odometer, concerns, line items, shop supplies and void metadata. RO number remains for audit on void. |
| `invoices`, `invoice_parts`, `invoice_labor`, `invoice_legacy_charges` | UUID PKs; Invoice optional `repairOrderId` unique, customer/vehicle links; unique `(shopId,repairOrderNumber)` and `(shopId,legacyRoNo)` | Status, `invoiceDate`, `closedAt`, snapshots, Decimal(12,2) totals. Legacy charge buckets preserve imported classifications. |
| `payments`, `accounts_receivable` | UUID PKs; optional `invoiceId` on Payment and unique `invoiceId` on AR; `customerId`, Decimal amounts | Multiple payments, payer type CUSTOMER/INSURANCE, AR balance and paid/open state. Payment actions lock/recompute and close on full payment. |
| `marketing_leads` | UUID PK, `(shopId,id)` unique; source CONTACT/APPOINTMENT/DROP_OFF; status NEW/CONTACTED/SCHEDULED/CONVERTED/CLOSED | Contact, requested service, vehicle, preferred vs confirmed schedule, attribution and submission path. Older generic call-click records are not operational leads. |
| `marketing_lead_notifications`, `marketing_lead_notification_reads` | One notification per lead; unique `(notificationId,userId)` read marker; composite shop-scoped FKs | Per-user unread counts, one notification per accepted lead when enabled. |
| `marketing_settings`, `marketing_pages`, `marketing_services`, `marketing_coupons`, `marketing_testimonials`, `marketing_gallery_items` | Shop-scoped; settings PK `shopId`; pages/services unique `(shopId,slug)` | DB-driven public content with explicit fallbacks and local preview mode. |
| `public_lead_submissions` | UUID PK; shop-scoped hashes/fingerprint indexed with `createdAt` | Short-lived anti-abuse ledger, not the lead table. |
| `audit_logs`, `staff_invites`, `canned_services`, `employees`, `legacy_import_runs`, `raw_legacy_*`, `legacy_import_errors` | Shop-scoped | Administration and legacy staging/evidence; never casually purge or replay. |

State is mostly server-owned: Server Components query `src/lib/data/*`, Server Actions in `src/app/(app)/**/actions.ts` and specific `*-actions.ts` enforce permissions and mutate via Prisma transactions, then `revalidatePath` or redirect. Forms use local React state and action state for editing/errors. Route params identify records; query params carry list filters (`/leads?status=NEW`, reports/search) and confirmation messages. `getCurrentMembership()` uses React `cache()` per server render, not a global authorization cache. Lead notifications use a client provider and poll every 20 seconds plus visibility/focus refresh; read markers persist in the DB, while toast/display state is transient. Sidebar state is `localStorage` key `plumworks:sidebar-collapsed` in `src/components/sidebar-controls.tsx`; the server shell renders `data-sidebar-collapsed="true"` initially. Marketing content is read from DB, a development-only JSON preview, or source fallbacks. There is no general client state library such as Redux.

## 4. Environment Setup & Run Commands

Use a real checkout of `palanichocku/plumworks`. Node 24 is used by `.github/workflows/cardoc-production-health.yml`; use that major locally. `npm ci` respects the lockfile. Set an ignored `.env.development.local` pointing **only** to the DEV Supabase project for guarded development commands. `.env.local` is used by the explicit Prisma CLI scripts and must be checked carefully before any migration. Do not copy production URLs into a development file. The `postinstall` hook runs Prisma generate, so the clean bootstrap below skips hooks and then calls the guarded generator after DEV configuration.

```bash
git clone https://github.com/palanichocku/plumworks.git
cd plumworks
npm ci --ignore-scripts
cp .env.example .env.development.local
# Edit .env.development.local with actual DEV credentials and the approved DEV target.
npm run db:dev:status
npm run db:dev:migrate            # applies pending migrations to the verified DEV target
npm run prisma:dev:generate
npm run dev                       # http://localhost:3000; validates DEV database identity

npm run lint
npx tsc --noEmit
npm run build
node --test tests/repair-order-void.test.mjs tests/invoice-multiple-payments.test.mjs
npm run test:monitoring
npm run test:seo

# For a deliberately selected deployment environment only, with reviewed .env.local:
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy      # uses DIRECT_URL; applies ALL pending migrations
npm run prisma:migrations:verify-security
```

`npm install` also works after supplying an appropriate `DIRECT_URL`, but the guarded sequence above makes the development target explicit. The first `npm run dev` will reject absent or mismatched DEV environment via `scripts/dev-database-command.mjs`. For the direct Prisma commands near the end, configure ignored `.env.local` for the deliberately selected target and verify `DIRECT_URL` before running anything that writes. Never use `prisma migrate dev` or `db push` against production. Migration ordering and backup procedure live in `docs/client-deployment-runbook.md` and `docs/cutover-runbook.md`. The static README is partly obsolete.

Baseline `.env` names and **dummy** values, reflecting `.env.example`:

```dotenv
DATABASE_URL="postgresql://user:password@dev-pooler.example.invalid:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://user:password@dev-db.example.invalid:5432/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://dev-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-public-anon-key"
SUPABASE_SERVICE_ROLE_KEY="dummy-server-only-service-role-key"
NEXT_PUBLIC_SITE_URL="https://www.example.invalid"
PLUMWORKS_PUBLIC_HOURS="Monday-Friday, 8 AM-5 PM"
PLUMWORKS_GOOGLE_REVIEW_URL="https://www.google.com/maps"
NEXT_PUBLIC_TURNSTILE_SITE_KEY="dummy-public-widget-key"
TURNSTILE_SECRET_KEY="dummy-server-siteverify-secret"
TURNSTILE_ALLOWED_HOSTNAMES="www.example.invalid,example.invalid"
LEAD_ABUSE_HASH_SECRET="dummy-replace-with-at-least-32-random-characters"
PUBLIC_LEAD_BLOCKED_EMAIL_DOMAINS="blocked.example.invalid"
MARKETING_LEADS_NOTIFY_EMAIL="owner@example.invalid"
TRANSACTIONAL_EMAIL_FROM="Example <notices@example.invalid>"
RESEND_API_KEY="dummy-resend-key"
EMAIL_FROM="Example <reports@example.invalid>"
PLUMWORKS_SHOP_NAME="Example Repair"
PLUMWORKS_SHOP_ADDRESS="100 Example Street"
PLUMWORKS_SHOP_CITY="Example City"
PLUMWORKS_SHOP_STATE="MI"
PLUMWORKS_SHOP_POSTAL_CODE="00000"
PLUMWORKS_SHOP_PHONE="000-000-0000"
PLUMWORKS_OWNER_EMAIL="owner@example.invalid"
PLUMWORKS_SHOP_SLUG="example-repair"
PLUMWORKS_SHOP_ID="00000000-0000-4000-8000-000000000000"
```

`DATABASE_URL` is the pooled runtime Prisma connection; `DIRECT_URL` is the direct migration connection. The `NEXT_PUBLIC_` values reach browser code; do not place secrets under that prefix. Supabase keys serve Auth/authorized server administration; service-role/secret keys stay server-side. `NEXT_PUBLIC_SITE_URL` is the canonical production marketing origin, not a preview URL. Hours and Google review URL feed public content/link fallbacks. Turnstile keys, hostname allowlist and stable random lead hash secret are required for protected public lead submissions; blocked domains are optional. Lead emails use Resend with the shop's recipient settings falling back to `MARKETING_LEADS_NOTIFY_EMAIL`; report/document email also has `EMAIL_FROM` and SMTP-related code. Shop/owner values are inputs for guarded client setup, not runtime tenant selectors; `PLUMWORKS_SHOP_ID` is an optional maintenance selector. Real Vercel Production and Preview values must target their corresponding databases; preview must never point at production merely to make a build pass.

Monitoring and preview keys are **additional** to `.env.example`:

```dotenv
MONITOR_BASE_URL="http://localhost:3000"
MONITOR_HEALTH_TOKEN="dummy-long-random-bearer-token"
MONITOR_USER_EMAIL="monitor@example.invalid"
MONITOR_USER_PASSWORD="dummy-monitor-password"
MONITOR_REPORT_EMAIL="operator@example.invalid"
MONITOR_HEARTBEAT_URL="https://heartbeat.example.invalid/dummy"
SUPABASE_SECRET_KEY="dummy-server-only-auth-admin-key"
MARKETING_CONTENT_PREVIEW_FILE="/absolute/path/to/local-preview.json"
```

The app server and smoke runner share `MONITOR_HEALTH_TOKEN`; `/api/health` uses it to authorize `SELECT 1`. The workflow reads monitor URL/login/report email/heartbeat and Resend secrets from GitHub Actions. `SUPABASE_SECRET_KEY` is used by guarded monitor-account setup, not the public client. The preview file is accepted only in local development (`NODE_ENV=development`, no Vercel flags). `npm run monitor:dev:smoke` then `npm run monitor:dev:report` use `.env.development.local`; see `docs/production-monitoring.md`, whose schedule prose is outdated relative to current workflow.

## 5. Current Feature Status (Honest Audit)

**Implemented in inspected source, with dedicated routes/actions/tests:**

- Auth/login, password recovery, invitation and permissions: `src/app/login`, `src/app/invite`, `src/app/update-password`, `src/lib/auth/*`, `src/lib/data/membership.ts`.
- Customer/vehicle search, lifecycle, archival/history, invoice and RO views: `src/app/(app)/customers`, `vehicles`, `repair-orders`, `invoices`, `src/lib/data/*`.
- Draft/Open RO editing, reassignment, odometer, parts/labor, scoped history drawer, print/PDF/email, finalize and audited void: `src/app/(app)/repair-orders/*`, `src/components/repair-order-*`, `src/lib/repair-order-*`. Workbench Parts/Labor split follows viewport width `64rem` (1024px) in `src/app/globals.css:55-70`; narrow view stacks. Overview/summary layout is separate.
- Native and imported invoices, split payments including insurance, AR, snapshots, void and reports: `src/app/(app)/invoices/*`, `/accounts-receivable`, `/reports`, `src/lib/invoice-*`, `src/lib/reportable-sales.ts`. Auto-close after final payment is in `src/app/(app)/invoices/payment-actions.ts:42-105`.
- Marketing pages, DB-backed content, SEO/redirects, structured lead forms, Turnstile/anti-abuse, lead tabs and notifications: `src/app/(marketing)/*`, `/leads`, `src/lib/marketing-*`, `src/lib/public-lead-*`, `src/components/lead-notification-*`, `next.config.ts`, `src/app/robots.ts`, `src/app/sitemap.ts`.
- Health endpoint and read-only functional smoke/email/heartbeat implementation: `src/app/api/health/route.ts`, `monitoring/*`, `scripts/monitor-{report,heartbeat}.ts`. The production workflow currently has only `workflow_dispatch` (`.github/workflows/cardoc-production-health.yml:3-4`); its last commit message says the schedule moved to cron-job.org. External schedule, 6 AM delivery and live Better Stack/Resend status are **not verified by this source audit**.
- Collapsible icon sidebar and portal tooltips are present at `src/components/app-shell.tsx`, `sidebar-controls.tsx`, `app-navigation.tsx:58-135`, and `src/app/globals.css:150-170`. Client storage preserves an explicit expanded choice across sign-out/sign-in; see backlog if the desired policy is collapse anew for every login.

**Real source fallbacks, constants and partial areas (these are not evidence of fake customer records):**

| Location at snapshot | Exact behavior / risk |
| --- | --- |
| `src/lib/marketing-content.ts:13-33` | Generic fallback hero/page copy, one placeholder coupon, one explicitly labeled review placeholder, and six gallery slots with `imageUrl:null`. Reviews page excludes `fallback-*` testimonials at `src/app/(marketing)/reviews/page.tsx:10,22`, so it does not display a fabricated customer quote. |
| `src/lib/marketing-content.ts:35-52,92-135` | DB content failure or absent tables falls back to static settings/services and, for some collections, placeholders. A missing DB can yield a superficially renderable public site; `/api/health` must be checked independently. |
| `src/lib/marketing.ts:19-47` | Public shop requires exactly one shop; errors return generic `Your Local Repair Shop` and fallback hours. This is a resilience fallback, not production shop data. |
| `src/lib/marketing-review-links.ts:4-16,27-32` | Car Doc Google Place ID and Facebook URL are constants, gated on exact normalized address **and** phone. Nonmatching tenants get no profiles. `PLUMWORKS_GOOGLE_REVIEW_URL` is validated against Google hosts; review cards link out and do not ingest live Google/Facebook ratings. |
| `src/lib/marketing-gallery-content.ts:1-20` | Gallery alt text is JSON-encoded into the existing caption column (`version:1`) rather than a dedicated column. Keep backwards decoding for plain captions. |
| `src/lib/business-profile.ts:3,35-37` | Type supports only `AUTOMOTIVE` and returns the automotive profile. Generic branding/module names are a starting abstraction, not completed HVAC/retail support. |
| `src/lib/marketing-content-preview.ts:57-62,130-140` | Local-only JSON preview, disabled on Vercel. It is intentional test content and cannot supply production content. |

**Known issues and open verification:** The user reported not seeing the sidebar enhancement after signing back into production; code presence does not prove that the serving Vercel deployment contains this SHA or that an existing `localStorage=false` state was reset. The October 4 health email showed 14/14 functional checks passing but Login took 34,521 ms and status WARNING; investigate recurrence rather than assuming current code fixes it. The requested dependable daily email by shop opening has not been demonstrated by the repository: the current workflow has no schedule and the external cron configuration is outside this checkout. Historical notes mention a full-project lint error in `src/app/(app)/admin/app-settings/page.tsx:37` and stale Dashboard test assertions; those reports are dated and **not re-run** here. No local checkout, live database, Vercel deployment, GitHub Project board, or current CI results were available during this document audit. Therefore do not infer live feature completion from code alone.

## 6. Vibe-Coding Quirks, Gotchas & "Do Not Touch" Rules

1. **Protect source and customer data.** `AGENTS.md` forbids modifications or commits in `OriginalWinApp/` and commits of DBF/FPT/CDX/FRX/FRT/EXE/DLL or extracted customer JSON. Private client assets/data live outside the shared repo. Never seed real customer data or use it in tests/screenshots. The historical `AGENTS.md` instruction to keep the app inside `app/` predates the actual `src/app/` layout; follow the current tree.
2. **Preserve reconciled reporting dates and totals.** `src/lib/reportable-sales.ts` selects native Invoice rows only when `status="closed"`, dated by `closedAt`; imported (`legacySourceTable != null`) use `invoiceDate`/Windows DATE_SOLD. Do not count an opened RO as a sale. January 2026 gross `$13,608.61`, Q1 `$48,908.49`, H1 `$130,599.15`, and 2025 `$273,292.61` are locked historical control totals from `CONTEXT_HANDOFF.md`. Reconcile any report math/void/charge changes to the penny. September's `$1.82` labor classification discrepancy was discussed separately; it was not a gross-total discrepancy.
3. **Do not replay legacy cutover.** The dated handoff states final production cutover makes Windows read-only and forbids a later full replacement. `scripts/legacy-cutover.mjs` uses explicit source, backup/verification gates and terminal events. Consult current `docs/cutover-runbook.md` and migration history before any DB write. Customer alias FK restricts deletion; reset ordering matters. Historical invoice customer ownership and archived recovered vehicles are deliberate.
4. **Keep shop and Auth boundaries.** Separate Supabase/Vercel projects are the intended client isolation model; row `shopId` and membership checks are defense in depth. `src/lib/data/membership.ts` selects the earliest membership for an Auth user; do not assume a shared-database multi-shop UI is implemented. `src/lib/marketing.ts` expects one shop. `src/lib/permissions.ts` must guard mutations even if navigation hides a page. MONITOR must stay read-only.
5. **Keep transactions and audit history.** Payment updates and AR/close state are transactional; void retains RO/invoice numbers, reason, note and auditability. `src/lib/marketing-lead-submission.ts` creates accepted lead and optional notification in one transaction; email failure is logged after commit and does not erase a lead. `src/lib/public-lead-admission.ts` uses shop-scoped PostgreSQL advisory transaction locks compatible with pooled connections, hash ledger and duplicate/rate limits. Avoid splitting admission and insert into separate requests. Duplicate/honeypot behavior intentionally avoids disclosing which check fired.
6. **Understand the sidebar's CSS/data-attribute coupling.** Initial `data-sidebar-collapsed="true"` is server markup; `useSyncExternalStore` reads browser storage and `src/app/globals.css` applies width/offset/label rules at `64rem`. Tooltips are portals because sidebar navigation scroll/overflow would clip them. A preference of `"false"` expands after hydration. Any “collapsed each login” change requires a defined session policy, not merely changing the default boolean.
7. **Do not erase legacy semantics while cleaning code.** Nullable legacy IDs/source fields, invoice charge buckets, shop-supply snapshots, and number allocation encode financial provenance. Imported invoices and native invoices differ. `MarketingLead.message` remains for older records even though public narrative text was removed. Reviews link gating and the fallback placeholder filter prevent fabricated testimonials from reaching the live page.
8. **Package/runtime quirks.** Next `16.2.10` and React `19.2.4` are exact in `package.json`; Prisma `^7.8.0` uses the adapter and generated-client location, with direct URL required by CLI. Tailwind 4 uses CSS/viewport media rules. Do not change versions or replace Prisma client construction as incidental cleanup. `npm run dev` is a guarded script, not `next dev`; `npm run db:dev:migrate` runs deploy against validated DEV. The repo has tests but this handover did not run them.

## 7. Immediate Backlog / Next Steps

1. **Make morning monitoring dependable and observable.** First inspect the external cron-job.org configuration, GitHub Actions run history and report email timestamps in America/Detroit; establish whether cron triggers `workflow_dispatch`, a health URL, or another integration, and whether report email always sends on failure. Source next edits, if needed: `.github/workflows/cardoc-production-health.yml`, `scripts/monitor-report.ts`, `scripts/monitor-heartbeat.ts`, `monitoring/login.ts`, `src/lib/monitoring/report.ts`, and `docs/production-monitoring.md`. Verify an actual morning run and delivery before closing the issue. Also investigate repeated Login >15,000 ms warnings (the October 4 sample was 34,521 ms).
2. **Verify and finish sidebar behavior on the serving production SHA.** Compare Vercel deployment commit to source, reproduce desktop sign-out/sign-in with old `plumworks:sidebar-collapsed=false`, and choose the desired policy: user preference or collapse anew on login (the user requested the latter). If changing policy, edit `src/components/sidebar-controls.tsx`, `src/components/app-shell.tsx`, `src/components/app-navigation.tsx`, `src/app/globals.css`, and the navigation regression tests (`scripts/app-shell-navigation.test.mjs`), then check icon tooltips at 1024px+, keyboard focus, mobile menu and 320px overflow. Record the deployed SHA and GitHub Project Done state.
3. **Plan and test a 1–2 day service-outage contingency.** Inventory existing guarded database backup/restore and external assets/email/Auth dependencies; rehearse a separate nonproduction recovery target with synthetic data and a return-to-primary reconciliation plan. Start with `docs/client-deployment-runbook.md`, `docs/cutover-runbook.md`, `scripts/db/{backup-public-db.sh,restore-public-db.sh,verify-public-db-backup.sh}`, `scripts/lib/public-db-backup.mjs`, and `src/lib/supabase/*`. Do not treat a public-schema dump as a complete Supabase Auth/Storage backup. Track the decision and rehearsal in the GitHub Project before implementation.

For any change: read `AGENTS.md`, inspect actual HEAD and migrations, work in a reviewable branch once the baseline permits, exercise focused tests and lint/type/build, and verify the deployed commit and real user flow. Treat the historical conversation as requirements/evidence, not as proof that current production matches this source snapshot.
