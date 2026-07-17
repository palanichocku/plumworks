# Client deployment runbook

Use this runbook for one repair shop per isolated Vercel project and Supabase project. Use synthetic data in staging. Never copy another client's database, environment file, Auth users, backups, or legacy exports into a new client project.

Client setup is parameterized and dry-run-first. It never changes a database unless the exact confirmation phrase is supplied.

## 1. Record the release and client deployment

- Choose an approved PlumWorks release tag and record its commit SHA.
- Follow `docs/releases.md`: validate locally, promote the same commit through staging, tag it with SemVer, and deploy that exact tag to client production.
- Assign non-secret identifiers for the client, Vercel project, Supabase project, region, production URL, and operator.
- Confirm the client has authorized the legacy data transfer and define secure source/backup locations outside the repository.
- For staging, use separate Vercel and Supabase projects populated only with synthetic data.

## 2. Create the Supabase project

1. Create a new Supabase organization/project named `plumworks-clientname` in the approved region with a unique generated database password. Use the same stable lowercase hyphenated client slug as Vercel.
2. Enable the required backup/PITR tier and record retention before loading production data.
3. In Auth URL Configuration, set the Site URL to the final production origin. Add only the required localhost and Vercel staging/preview callback origins to the matching non-production project.
4. Obtain the pooled application connection, direct migration connection, project URL, and publishable/anon key from the project dashboard.
5. Store credentials only in the approved password manager and deployment environment. Do not paste values into tickets, docs, logs, screenshots, or source control.
6. Do not expose the service-role key to the browser. The current app does not require it at runtime.

## 3. Create the Vercel project

1. Import the shared repository at the approved release tag/branch.
2. Select Next.js with the repository root as the project root and the standard `npm run build` build command.
3. Name the project `plumworks-clientname`, where `clientname` is a stable lowercase hyphenated client slug. Do not put that slug into shared source code.
4. Configure deployment protection and team access. Limit production deployment permission.
5. Attach and verify the custom domain, then update the matching Supabase Auth Site URL/redirect allowlist.
6. Ensure preview deployments use the staging Supabase project or have no database credentials. Never point a preview deployment at client production.

## 4. Set environment variables

Set these per Vercel environment without printing their values:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Runtime; Production/Preview as applicable | Supabase pooled Postgres connection used by the app and maintenance scripts. |
| `NEXT_PUBLIC_SUPABASE_URL` | Runtime; matching project only | Supabase project API URL. Public by design, but still manage it per environment. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Runtime; matching project only | Supabase browser/Auth anon key. Never substitute the service-role key. |
| `DIRECT_URL` | CI/operator migration and cutover environment; avoid runtime unless required | Direct Postgres connection for Prisma migrations and backup tooling. |
| `NEXT_PUBLIC_SITE_URL` | Runtime; matching production origin | Canonical public website origin used for sitemap URLs. |
| `PLUMWORKS_PUBLIC_HOURS` | Runtime; per client | Customer-facing shop hours shown on public marketing pages. |
| `PLUMWORKS_GOOGLE_REVIEW_URL` | Runtime; optional per client | Verified HTTPS destination for the public Google review CTA. |

Client setup accepts CLI parameters or these operator-only environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PLUMWORKS_SHOP_NAME` | Yes | Shop display/legal name. |
| `PLUMWORKS_SHOP_ADDRESS` | Yes | Primary street address. |
| `PLUMWORKS_SHOP_CITY` | Yes | City. |
| `PLUMWORKS_SHOP_STATE` | Yes | State/region. |
| `PLUMWORKS_SHOP_POSTAL_CODE` | Yes | Postal code. |
| `PLUMWORKS_SHOP_PHONE` | Yes | Shop phone. |
| `PLUMWORKS_OWNER_EMAIL` | Yes | Email of the first Supabase Auth owner. |
| `PLUMWORKS_SHOP_SLUG` | No | Validated operational slug used for the `plumworks-clientname` project convention; it is not persisted. |
| `PLUMWORKS_INVOICE_FOOTER_MESSAGE` | No | Footer used only when the legacy company-settings utility is explicitly run. |

`SUPABASE_SERVICE_ROLE_KEY` appears in `.env.example`, but no current runtime use was found. Leave it unset in Vercel unless a reviewed server-only feature requires it.

For local operator commands, create an untracked `.env.local` from the approved secret store. Confirm `.env.local` is ignored. Never display or commit its contents.

## 5. Validate and run migrations

From the exact approved release:

```bash
npm ci
npx prisma validate
npx prisma generate
npm run lint
npm run build
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

Use the new client's `DIRECT_URL` for Prisma commands. Do not run `prisma migrate dev`, `db push`, or an ad hoc migration against staging or production. Stop if migration history is divergent or a migration fails; do not mark it resolved without review and recovery evidence.

## 6. Seed/setup the shop

Run a dry-run first. CLI parameters take precedence over the setup environment variables listed above:

```bash
npm run client:setup -- \
  --shop-name "Example Repair" \
  --address "100 Example Street" \
  --city "Example City" \
  --state "MI" \
  --postal-code "00000" \
  --phone "000-000-0000" \
  --owner-email "owner@example.invalid" \
  --shop-slug "example-repair" \
  --dry-run
```

Review the count-only plan. The command refuses databases with more than one shop. With zero shops it plans a generated-UUID shop; with one shop it updates that row in place, preserving its UUID and all related data. To apply the reviewed plan:

```bash
npm run client:setup -- \
  --shop-name "Example Repair" \
  --address "100 Example Street" \
  --city "Example City" \
  --state "MI" \
  --postal-code "00000" \
  --phone "000-000-0000" \
  --owner-email "owner@example.invalid" \
  --shop-slug "example-repair" \
  --confirm SETUP_PLUMWORKS_CLIENT
```

`npm run db:seed -- <same arguments>` uses the same implementation and safeguards. It is dry-run-only unless the exact confirmation phrase is present. Neither command creates or changes customers, vehicles, repair orders, invoices, or legacy staging data.

After setup, verify there is exactly one shop and review its name, address, city, state, postal code, phone, invoice defaults, tax behavior, next repair-order number, footer, and warranty text. Retain the shop UUID in the secure deployment record for scoped maintenance commands.

## 7. Create the owner user and membership

1. Create the initial owner in the client Supabase dashboard under **Authentication → Users**, or have the owner complete the approved signup/login flow. Require the verified owner email and deliver credentials/reset instructions through an approved secure channel.
2. Run `client:setup` in dry-run mode with the same `--owner-email`. If no matching Auth user exists, the script performs no owner write and prints the next steps.
3. After the Auth user exists, rerun the reviewed setup with `--confirm SETUP_PLUMWORKS_CLIENT`. The script creates the membership or promotes the matching membership to `OWNER` transactionally.
4. Sign in as that owner. Create subsequent staff invitations through **Admin → Staff** and follow `docs/admin-staff-onboarding.md`.

Setup never demotes or removes an owner, so it cannot bypass last-owner protection.

Do not create an owner membership for an unverified email, and never use a service-role key in client-side code.

## 8. Import legacy data

1. Obtain a final, read-only copy of the approved Shopman32 data folder outside `OriginalWinApp/` and outside source control.
2. Confirm all required DBF/FPT files are readable and record checksums in the protected cutover record. Never commit source files or extracted sample JSON.
3. Run the consolidated cutover dry-run with explicit source path:

```bash
npm run legacy:cutover:dry-run -- --source /approved/read-only/Shopman32/data --report --summary-only
```

4. Review source counts, reconciliation gaps, expected clean counts, accounting totals, and validation issues. Dry-run must report zero database writes.
5. Before production reload, confirm managed backup/PITR and follow `docs/cutover-runbook.md`. Use the explicit shop-scoping enhancement required by the readiness audit once available; until then, independently verify the database contains exactly one shop.
6. Store cutover reports and backups in encrypted, access-controlled client storage. Do not commit them.
7. Schedule downtime and perform the confirmed backup/reset/reload command only after client approval. The reload preserves the shop, memberships, invites, canned services, settings, Auth users, migrations, and security configuration, but replaces scoped operational/staging data.

## 9. Verify the data and security boundary

- Confirm the cutover report passes source, row-count, preservation, RLS/access-hardening, and accounting checks.
- Reconcile customer, vehicle, invoice, open repair order, payment, and receivable totals against approved legacy expectations.
- Confirm no real client data appears in logs, Vercel build output, screenshots, tests, fixtures, or repository files.
- Verify an unauthenticated request cannot access application pages or data.
- Verify the owner sees only the configured shop and that all exported records belong to it.
- Review invoice identity/contact details, totals, footer, warranty, tax defaults, and starting repair-order number.

## 10. Deploy production

1. Confirm the approved tag/SHA, successful staging checks, production backup status, completed migrations, shop setup, owner access, and cutover verification.
2. Deploy the exact approved release to the client Vercel production project; do not rebuild from an unreviewed branch.
3. Record Vercel deployment ID, release tag/SHA, migration state, operator, time, and rollback decision point.
4. Keep the previous known-good deployment available for application rollback. Remember that application rollback does not reverse database migrations or imported data.

## 11. Smoke test

Use a designated test account and synthetic test records only. Do not alter imported client records merely to test.

- Sign in, sign out, and verify unauthorized redirect behavior.
- Confirm dashboard, customer search/detail, vehicle detail, service history, invoices, and accounts receivable load.
- Create a synthetic customer and vehicle, create a repair order, add parts/labor, print the estimate, finalize it, record a supported payment, and verify reports/balance behavior.
- Delete or clearly label synthetic records using the application's approved workflow; do not run cleanup scripts without reviewing their exact scope.
- Verify Admin Shop Settings, staff invitation flow, audit log, data exports, Help pages, mobile navigation, and print layouts.
- Confirm shop name/contact information and PlumWorks powered-by branding are correct.
- Confirm there is no public marketing route unless a reviewed, default-off feature has explicitly been enabled.

## 12. Backup and recovery policy

- Enable Supabase managed backups before initial production import. Use PITR when the client's recovery objectives require it.
- Define and record RPO, RTO, retention, encryption, access owners, and restore approval. A reasonable starting policy is daily managed backup plus PITR where available, with longer encrypted snapshots before migrations and cutovers.
- Create a pre-migration backup for risky releases and the mandatory cutover backup described in `docs/cutover-runbook.md`.
- Store exports/backups separately per client, encrypted at rest, with least-privilege access and lifecycle deletion. Never store them in Git or Vercel build artifacts.
- Test restoration into an isolated recovery project on a scheduled basis and document the result. A backup is not accepted until a restore procedure has been exercised.
- Review Supabase backup health and access logs regularly. Escalate missed backups immediately and pause destructive maintenance until recovery coverage is restored.

## Production sign-off checklist

- [ ] Approved release tag and SHA recorded
- [ ] Dedicated Vercel and Supabase projects confirmed
- [ ] Environment scopes and Auth redirect URLs verified
- [ ] Prisma validation, generation, lint, and build pass
- [ ] Migration status clean before and after deploy
- [ ] Exactly one shop configured with correct settings
- [ ] Initial owner Auth user and `OWNER` membership verified
- [ ] Managed backup/PITR and restore policy verified
- [ ] Legacy dry-run, approved cutover, and reconciliation pass
- [ ] RLS/access-hardening and unauthenticated-access checks pass
- [ ] Production deployment ID recorded
- [ ] Smoke test passes using synthetic records
- [ ] Rollback owner and decision point recorded
