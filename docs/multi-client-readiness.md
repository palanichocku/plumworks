# Multi-client single-tenant readiness audit

Audit date: 2026-07-17

## Scope and deployment model

The target model is one shared PlumWorks codebase with a separate Vercel project and separate Supabase project for every repair shop. This is not a shared-database multi-tenant deployment. The existing `shop_id` relationships and membership checks remain useful defense in depth, but each deployment should contain exactly one configured shop.

No database rows, migrations, environment values, or legacy files were changed during this audit.

Status meanings:

- **Ready** — usable for the target model without a blocking change.
- **Needs cleanup** — should be corrected before repeating client deployments.
- **Later** — not required for the current private shop application, but required before the named feature or a mature release process.

## Readiness summary

| Area | Status | Finding |
| --- | --- | --- |
| Runtime tenant scoping | **Ready** | Application reads and writes are generally scoped by the authenticated user's shop membership. Shop identity shown in the shell, Help, invoices, and print views comes from the shop row. |
| Repeatable client provisioning | **Needs cleanup** | The seed hard-codes the current Car Doc identity and UUID, and there is no supported owner-bootstrap command. |
| Legacy import/cutover | **Needs cleanup** | The consolidated cutover is guarded and preserves shop/admin/settings data, but it selects the oldest shop implicitly. Several component scripts default to a fixed UUID and repository-local legacy paths. |
| Per-client infrastructure | **Needs cleanup** | Required connection/Auth variables are identifiable, but Vercel/Supabase setup, environment validation, redirect configuration, and a client-specific deployment convention are not automated. |
| Shop branding/settings | **Needs cleanup** | Core shop contact and invoice settings are stored in the database, but Admin cannot edit all identity fields and there is no logo/theme configuration. |
| Software branding | **Ready** | PlumWorks/powered-by wording is centralized in `src/lib/branding.ts` and a branding verification script exists. It is intentionally product branding, not client branding. |
| Public/marketing features | **Later** | No public website, coupon, appointment, drop-off, or feature-flag model exists. |
| Release process | **Needs cleanup** | Package version is `0.1.0`; no changelog, release notes, tagging convention, staging policy, or production checklist exists outside the new runbook. |

## 1. Hard-coded Car Doc references

| Item | Status | Evidence and impact |
| --- | --- | --- |
| `src/`, metadata, and Help pages | **Ready** | No Car Doc/Cardoc literal was found. Metadata uses centralized PlumWorks software branding; authenticated UI uses the membership's shop name. |
| `scripts/` | **Needs cleanup** | `import-legacy-company-settings.mjs` writes a Car Doc-specific invoice footer. This must be derived from imported company data, an explicit argument, or omitted. |
| `prisma/` and seed | **Needs cleanup** | `prisma/seed.mjs` hard-codes Car Doc's name, address, phone, and UUID. One migration comment also names Car Doc; the comment is harmless at runtime but should be product-neutral in future migrations (do not rewrite an applied migration solely for this). |
| `docs/`, README, cutover reports | **Needs cleanup** | README says a transform targets the Car Doc shop. Cutover report content is otherwise count/metadata oriented and does not embed a shop name, but generated `reports/` and `backups/` need an explicit ignore/retention policy before client use. |
| `package.json` | **Ready** | Package/product name is PlumWorks and commands are not client-named. Version/release maturity is covered below. |

## 2. Client-specific assumptions

| Item | Status | Evidence and impact |
| --- | --- | --- |
| Fixed shop UUID | **Needs cleanup** | Seed uses a fixed UUID. Import/transform scripts for open orders, invoices, and customers/vehicles default to it; several diagnostics use it unconditionally. Require `--shop-id` (or a validated provisioning variable) and fail closed when absent. |
| Fixed shop name/contact details | **Needs cleanup** | Seed contains the current tenant's name, street, city, state, postal code, and phone. Move provisioning inputs to explicit CLI arguments or environment variables; keep canonical values in `shops`. |
| Fixed source paths | **Needs cleanup** | Some import scripts fall back to `OriginalWinApp/Shopman32/data`; labor memo utilities require that path. Production cutover already accepts `--source`. All client-facing imports should require an explicit readable source folder and never default to repository data. |
| Fixed Vercel project name | **Ready** | No fixed Vercel project/domain was found. A naming convention is still needed operationally. |
| Fixed Supabase project | **Ready** | Runtime selects Supabase solely through environment variables; no project ref or hostname is hard-coded. |
| Implicit first shop | **Needs cleanup** | Membership lookup and cutover use the first matching/oldest row. This works with exactly one shop but does not assert that invariant. Provisioning and cutover should abort unless exactly one shop exists or an explicit shop ID is supplied. |

## 3. Deployment readiness

| Item | Status | Finding |
| --- | --- | --- |
| Per-client environment variables | **Needs cleanup** | Runtime needs `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; Prisma migration/cutover workflows need `DIRECT_URL`. `SUPABASE_SERVICE_ROLE_KEY` is documented in `.env.example` but no application use was found, so do not configure it in Vercel unless a future server-only workflow requires it. Add startup/CI validation and document preview-vs-production values. |
| Vercel project setup | **Needs cleanup** | Compatible with separate projects, but framework/root directory, environment scopes, deployment protection, custom domain, and Supabase Auth redirect URLs are not codified. See the client runbook. |
| Supabase setup | **Needs cleanup** | Schema and Auth integration exist. Project creation, connection modes, Auth URL configuration, RLS/access-hardening verification, backups, and region selection remain manual. |
| Migrations | **Ready** | Prisma migration history exists and `prisma.config.ts` uses `DIRECT_URL`. Deploy with `npx prisma migrate deploy`; never use `migrate dev` against client production. No new migration is necessary merely to deploy another isolated client. |
| Shop seed/setup | **Needs cleanup** | Current seed is idempotent but tenant-specific. Replace it with a generic, fail-closed setup command that creates one shop from explicit inputs and refuses to overwrite an existing shop unless deliberately requested. |
| Owner membership setup | **Needs cleanup** | Staff invite acceptance exists after an owner/admin can create an invite, but the first owner has no supported bootstrap workflow. Add a server-side CLI that looks up an existing Supabase Auth user and creates exactly one `OWNER` membership transactionally, without accepting a service-role key in browser code. |
| Cutover/reload | **Needs cleanup** | Consolidated cutover supports dry-run, source validation, mandatory backup/confirmation, preservation checks, reload, verification, and reports. It must accept/validate an explicit shop ID and remove defaults from child scripts before multi-client use. |

## 4. Release readiness

| Item | Status | Recommendation |
| --- | --- | --- |
| Version tagging plan | **Needs cleanup** | Adopt SemVer tags (`vMAJOR.MINOR.PATCH`) from the shared main branch. Record the deployed tag and commit SHA per client/Vercel project. Do not encode client identity in source tags. |
| Release notes/changelog | **Needs cleanup** | Add `CHANGELOG.md` using Keep a Changelog sections. Each release should call out migrations, provisioning changes, import/cutover changes, security changes, and rollback constraints. |
| Staging deployment | **Needs cleanup** | Use a dedicated non-production Vercel project and Supabase project with synthetic data. Validate migrations and cutover tooling there; never connect previews to a production Supabase project. |
| Production deployment checklist | **Needs cleanup** | The runbook below supplies the initial checklist. It should become a release-gated checklist with named operator, release tag/SHA, backup evidence, migration result, smoke-test result, and rollback decision. |

Recommended promotion flow: merge and tag the shared release, deploy the tag to common staging, run automated checks and synthetic smoke tests, then promote the identical tag independently to each client project. Database migrations are forward-only and run once per client Supabase project before application promotion.

## 5. Feature and configuration readiness

| Item | Status | Finding |
| --- | --- | --- |
| Shop-specific name/contact branding | **Needs cleanup** | Shop name, address, city/state/postal code, and phone exist in `shops` and are displayed dynamically. Admin Shop Settings currently edits invoice/tax defaults and document text, not these identity fields. |
| Logo/colors/document branding | **Later** | No shop logo storage, theme colors, public assets, or configurable document branding fields exist. Use Supabase Storage plus database references when needed; do not add client assets to shared source. |
| Powered-by software branding | **Ready** | PlumWorks branding is centralized and consistently shown. Keep it product-owned and separate from shop branding. |
| Public website enable/disable | **Later** | No public website surface or configuration exists. Introduce an explicit default-off flag before adding public routes. |
| Coupons | **Later** | No coupon model or flag exists. |
| Appointments | **Later** | No appointment model or flag exists. |
| Drop-off | **Later** | No drop-off workflow or flag exists. |
| Admin-editable feature flags | **Later** | No feature configuration model/UI exists. Prefer typed per-shop flags in the database for business configuration, with deployment-only operational settings in environment variables. Default every new public feature off. |

## Highest-priority fixes before a public marketing website

1. Replace the tenant-specific seed with an explicit, generic shop provisioning command and add a safe first-owner bootstrap command.
2. Remove fixed UUID/source defaults from all import, transform, diagnosis, and cutover paths; require `--shop-id` and `--source`, and make cutover assert the one-shop invariant.
3. Remove the Car Doc-specific footer from the company-settings importer and correct tenant-specific README wording.
4. Add validated deployment configuration, including separate preview/staging credentials, Supabase Auth redirect URLs, and a policy that previews never use production databases.
5. Make all existing shop identity/contact fields editable by authorized Admin users; add audit logging consistent with existing settings updates.
6. Add release tagging, `CHANGELOG.md`, staging promotion, backup/rollback evidence, and per-client deployed-version tracking.
7. Before creating any public route, add a default-off public-site flag, define which pages require authentication, add abuse/privacy controls, and keep coupons, appointments, and drop-off independently disabled until implemented and tested.

## Migration decision

No database migration is clearly necessary for the core separate-project deployment model. A later migration will be appropriate only when adding persisted shop logos/themes or feature flags. The immediate blockers are provisioning/script/configuration cleanup, not schema changes.
