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
| Repeatable client provisioning | **Ready** | `scripts/setup-client.mjs` and the seed accept explicit CLI/environment inputs, default to dry-run, preserve an existing sole shop UUID, and bootstrap a matching Auth user as owner only after confirmation. |
| Legacy import/cutover | **Needs cleanup** | The consolidated cutover is guarded and preserves shop/admin/settings data, but it selects the oldest shop implicitly. Several component scripts default to a fixed UUID and repository-local legacy paths. |
| Per-client infrastructure | **Needs cleanup** | Required connection/Auth variables are identifiable, but Vercel/Supabase setup, environment validation, redirect configuration, and a client-specific deployment convention are not automated. |
| Shop branding/settings | **Needs cleanup** | Core shop contact and invoice settings are stored in the database, but Admin cannot edit all identity fields and there is no logo/theme configuration. |
| Software branding | **Ready** | PlumWorks/powered-by wording is centralized in `src/lib/branding.ts` and a branding verification script exists. It is intentionally product branding, not client branding. |
| Public/marketing features | **Later** | No public website, coupon, appointment, drop-off, or feature-flag model exists. |
| Release process | **Needs cleanup** | Package version is `0.1.0`; no changelog, release notes, tagging convention, staging policy, or production checklist exists outside the new runbook. |

## 1. Hard-coded original-client references

| Item | Status | Evidence and impact |
| --- | --- | --- |
| `src/`, metadata, and Help pages | **Ready** | No original-client literal was found. Metadata uses centralized PlumWorks software branding; authenticated UI uses the membership's shop name. |
| `scripts/` | **Ready** | Client setup and the legacy company-settings footer are parameterized. The software-brand verification rejects original-client literals. |
| `prisma/` and seed | **Ready** | The seed delegates to generic client setup. An applied migration retains one historical tenant-named comment; migrations are excluded from branding verification and are not rewritten after application. |
| `docs/`, README, cutover reports | **Ready** | Instructions are client-neutral. Generated `reports/` and `backups/` are ignored and must remain in protected client storage. |
| `package.json` | **Ready** | Package/product name is PlumWorks and commands are not client-named. Version/release maturity is covered below. |

## 2. Client-specific assumptions

| Item | Status | Evidence and impact |
| --- | --- | --- |
| Fixed shop UUID | **Ready** | Setup generates a UUID for a new shop and preserves the sole existing shop UUID. Client-facing import/transform commands require `--shop-id`; maintenance/cutover commands resolve the sole shop or accept explicit `PLUMWORKS_SHOP_ID`/`--shop-id` selection. |
| Fixed shop name/contact details | **Ready** | Setup requires explicit CLI/environment inputs and keeps canonical values in `shops`. |
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
| Shop seed/setup | **Ready** | Setup is generic, count-only, dry-run-first, confirmation-gated, and refuses a database containing multiple shops. |
| Owner membership setup | **Ready** | Setup looks up the existing Supabase Auth user and transactionally creates or promotes its membership. It never removes/demotes owners and gives manual Auth-first steps when no user exists. |
| Cutover/reload | **Needs cleanup** | Consolidated cutover supports dry-run, source validation, mandatory backup/confirmation, preservation checks, reload, verification, and reports. It must accept/validate an explicit shop ID and remove defaults from child scripts before multi-client use. |

## 4. Release readiness

| Item | Status | Recommendation |
| --- | --- | --- |
| Version tagging plan | **Ready** | `docs/releases.md` defines SemVer tags (`vMAJOR.MINOR.PATCH`) and requires the deployed tag and commit SHA per client project. |
| Release notes/changelog | **Needs cleanup** | Add `CHANGELOG.md` using Keep a Changelog sections. Each release should call out migrations, provisioning changes, import/cutover changes, security changes, and rollback constraints. |
| Staging deployment | **Needs cleanup** | Use a dedicated non-production Vercel project and Supabase project with synthetic data. Validate migrations and cutover tooling there; never connect previews to a production Supabase project. |
| Production deployment checklist | **Ready** | The client runbook includes release, infrastructure, environment, migration, setup, owner, cutover, verification, deployment, smoke-test, backup, and rollback sign-off. |

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

1. Remove repository-local legacy source defaults from the remaining import/restaging utilities and require explicit approved source paths.
2. Add validated deployment configuration, including separate preview/staging credentials, Supabase Auth redirect URLs, and a policy that previews never use production databases.
3. Exercise generic setup and owner bootstrap against synthetic staging as a release gate.
4. Make all existing shop identity/contact fields editable by authorized Admin users; add audit logging consistent with existing settings updates.
5. Add a changelog and per-client deployed-version tracking to the documented release/tagging flow.
6. Before creating any public route, add a default-off public-site flag, define which pages require authentication, add abuse/privacy controls, and keep coupons, appointments, and drop-off independently disabled until implemented and tested.

## Migration decision

No database migration is clearly necessary for the core separate-project deployment model. A later migration will be appropriate only when adding persisted shop logos/themes or feature flags. The immediate blockers are provisioning/script/configuration cleanup, not schema changes.
