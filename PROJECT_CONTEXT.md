# PlumWorks / Car Doc — Project Context

> **Current source snapshot:** `palanichocku/plumworks`, `main` at `211b4a0be604cc55f1f7b18447b20ebca506b6fd` (2026-10-23). This file is intended to be the primary AI/developer handoff for the current application. It supersedes the older 2026-10-05 snapshot that was previously in `PROJECT_CONTEXT.md` and the much older `CONTEXT_HANDOFF.md`. Paths are repository-relative. Re-check actual branch HEAD, database migration status, Vercel deployment SHA, GitHub Project state, and external monitoring configuration before any production-changing work. No production secrets or customer data belong in this file.

## 1. Project Overview & Product Vision

PlumWorks is a small-business operations SaaS. **Car Doc LLC** is the first production automotive customer and is currently the reference implementation. The application combines the shop's authenticated operating system and its public marketing website in one Next.js codebase.

The current Car Doc workflow is:

1. A prospective customer reaches the business through the public website (`/contact`, `/appointment`, `/drop-off`) or by phone.
2. Website submissions are validated, protected by anti-abuse controls, stored as `MarketingLead` records, and may generate in-app/email notifications.
3. Staff work leads through **New → Contacted → Scheduled**. When a web lead is scheduled, PlumWorks links an existing matching customer or creates a new Customer, marks a newly created customer with acquisition source `WEB`, and creates the submitted vehicle when enough vehicle data exists.
4. Staff create a Repair Order (RO) for the customer/vehicle. If the customer is linked to an eligible web lead, RO creation automatically moves that lead to **Converted** and stamps `convertedAt`; staff do not manually perform the conversion step.
5. In the RO workspace, staff capture customer concerns, recommendations, current mileage, parts, labor, complimentary labor, vendors, internal notes, and customer/vehicle edits without leaving the RO. Parts/labor display order is persisted.
6. The customer estimate must normally be authorized before invoice creation. Authorization may be recorded verbally or obtained through an emailed approval link. Evidence is stored as immutable, revisioned authorization records rather than a mutable checkbox.
7. Creating the Invoice freezes the relevant shop/customer/vehicle/financial snapshots and makes the RO read-only. OWNER/ADMIN may override missing authorization only with a required reason; the override is governance-audited.
8. The Invoice supports editing while open, PDF/print/email, complimentary work, multiple payments and payer types, AR, voiding, and final payment auto-close. Warranty, authorization, and certification copy are rendered from the invoice/shop snapshot so historical documents do not silently change when Shop Settings change later.
9. At vehicle delivery, customer and shop representative signatures can be captured and retained as immutable invoice evidence.
10. Reports operate from invoice sales semantics, including imported Shopman32 history, and must continue to reconcile to established control totals.

### Product positioning

The long-term intent is a reusable PlumWorks SaaS for additional small-business verticals. The current implementation is still automotive-first: `src/lib/business-profile.ts` exposes the automotive profile and the production workflows, terminology, evidence, legacy import, and document formats are designed around repair shops. Do not describe the current application as a completed generic multi-vertical platform.

### Primary routes

Public Car Doc routes include:

- `/`
- `/about`
- `/services`
- `/services/[slug]`
- `/reviews`
- `/photos`
- `/coupons`
- `/appointment`
- `/contact`
- `/drop-off`
- `/privacy`
- public authorization route `/authorize/repair-order/[token]`

Authenticated application routes include:

- `/repair-orders`
- `/invoices`
- `/customers`
- `/vehicles`
- `/leads`
- `/website`
- `/dashboard`
- `/reports`
- `/admin`
- `/help`
- `/accounts-receivable`
- `/search`

The current navigation order is intentionally business-workflow-oriented: **Repair Orders → Invoices → Customers → Vehicles → Leads → Website → Dashboard → Reports → Admin → Help → Accounts Receivable**.

Production public site: `www.subbuscardoc.com`. PlumWorks product/company domain: `plumworksapp.com`.

---

## 2. Architecture & File Tree

### Runtime and framework

- **Next.js:** `16.2.10`, App Router
- **React / React DOM:** `19.2.4`
- **TypeScript:** `^5`
- **Node:** monitoring CI currently uses Node 24
- **Styling:** Tailwind CSS 4 plus application CSS in `src/app/globals.css`
- **Notifications:** `react-hot-toast`
- **Help diagrams:** `mermaid`
- **PDF generation:** `@react-pdf/renderer`
- **Browser monitoring:** Playwright

### Database and server architecture

- PostgreSQL hosted by Supabase
- Prisma `7.8.x` using `@prisma/adapter-pg`
- Runtime connection uses `DATABASE_URL`
- Prisma migration/CLI operations use `DIRECT_URL`
- Generated application Prisma client lives under `src/generated/prisma`
- A second packaged Prisma client generator exists for plain Node maintenance scripts
- Most application reads occur in Server Components / `src/lib/data/*`
- Mutations use Server Actions and Prisma transactions, usually followed by `revalidatePath` and/or redirect

### Authentication and authorization

- Supabase Auth via `@supabase/ssr` and `@supabase/supabase-js`
- Auth cookie/session handling is centered around `src/proxy.ts` and `src/lib/supabase/*`
- Application access also requires a valid `ShopMembership`; an authenticated Supabase user alone is not enough
- Roles: `OWNER`, `ADMIN`, `STAFF`, `MONITOR`
- Permission checks are centralized in `src/lib/permissions.ts` / permission matrix
- `MONITOR` must remain read-only and is used for production smoke checks

### Deployment model

- Vercel hosts the app and public site
- Supabase provides PostgreSQL/Auth
- The current intended tenant-isolation model is **separate deployment/database per client**, with `shopId` scoping retained as defense in depth
- DEV uses the `plumworks-dev` environment/project; production Car Doc uses its own production resources
- Preview deployments must never be pointed at the production database merely to make a build pass

### Key file map

```text
PROJECT_CONTEXT.md
  Primary current AI/developer handoff. Keep this updated after major architecture/workflow changes.

AGENTS.md
  Repository safety constraints. Read before modifying code or legacy artifacts.

package.json / package-lock.json
  Runtime dependencies and operational scripts. Lockfile integrity is CI-guarded.

prisma/schema.prisma
  Current authoritative Prisma model surface.

prisma/migrations/
  Database history. Major recent migrations add authorization evidence,
  authorizer relationship, email subject/session role, evidence hardening,
  lead-customer attribution, and persisted RO line positions.

src/proxy.ts
  Session/auth routing and public/private route handling. `/api/health` must remain
  reachable with its bearer token for monitoring.

src/app/(app)/layout.tsx
  Authenticated application shell/membership boundary.

src/components/app-shell.tsx
src/components/app-navigation.tsx
src/components/sidebar-controls.tsx
src/components/app-session-footer.tsx
  Main application chrome, collapsible navigation, tooltips/session UI.

src/app/(app)/repair-orders/
src/components/repair-order-*.tsx
  RO list/detail/create/finalize/void/reassignment/reorder/save workflows.

src/components/repair-order-unified-line-items.tsx
src/components/expandable-description-field.tsx
src/components/dictation-button.tsx
src/components/historical-description-combobox.tsx
src/components/vendor-combobox.tsx
  Current UAT-era line-entry experience: expanded descriptions, persisted ordering,
  vendor typeahead, historical suggestions, and persistent uppercase dictation.

src/app/(app)/repair-orders/[id]/authorization-evidence/page.tsx
src/components/repair-order-authorization-panel.tsx
src/lib/authorization/repair-order-evidence.ts
src/lib/authorization/remote-repair-order-authorization.ts
src/lib/authorization/repair-order-readiness.ts
  Repair-order authorization, evidence history, readiness, and remote approval.

src/app/authorize/repair-order/[token]/page.tsx
src/app/authorize/repair-order/actions.ts
  Public tokenized customer approval/decline flow.

src/app/(app)/invoices/
src/components/invoice-edit-workspace-v2.tsx
src/components/invoice-edit-workspace-v3.tsx
src/components/invoice-payment-form.tsx
  Invoice detail/edit/payment lifecycle and current redesigned workspaces.

src/app/(app)/invoices/[id]/delivery-signatures/page.tsx
src/components/invoice-delivery-signature-capture.tsx
src/components/invoice-delivery-signature-panel.tsx
src/lib/authorization/invoice-signature-evidence.ts
  Delivery acknowledgement/customer + shop representative signature evidence.

src/components/invoice-document-html.tsx
src/components/pdf/invoice-document-pdf.tsx
src/lib/invoice-document.ts
  Print/email/PDF invoice rendering. Keep layout changes synchronized across outputs.

src/app/(app)/customers/
src/app/(app)/vehicles/
src/components/customer-edit-form.tsx
src/components/vehicle-edit-form.tsx
src/components/edit-record-dialog.tsx
  Master records plus inline edit dialogs used from the RO.

src/app/(app)/leads/
src/components/marketing-lead-card.tsx
src/components/lead-management-form.tsx
src/lib/marketing-lead-*.ts
  Lead status, scheduling, notifications, linked customer/vehicle creation,
  conversion attribution and revenue funnel behavior.

src/app/(marketing)/
src/lib/marketing-*.ts
src/lib/public-lead-*.ts
  Public Car Doc site, DB-backed content, lead forms, attribution and abuse controls.

src/app/api/health/route.ts
monitoring/health.spec.ts
monitoring/login.ts
scripts/monitor-report.ts
.github/workflows/cardoc-production-health.yml
  Production monitoring path, functional smoke checks, report email, Better Stack heartbeat.

src/lib/reportable-sales.ts
src/lib/daily-sales-aggregation.ts
src/lib/sales-report-period.ts
  Reporting/sales-date semantics. Financial reconciliation rules are sensitive.

scripts/legacy-*.mjs
scripts/lib/legacy-*.mjs
scripts/db/
docs/cutover-runbook.md
  Shopman32 import, rehearsal, cutover, backup and verification tooling.

scripts/create-dev-user.mjs
scripts/rename-dev-user-email.mjs
scripts/reset-user-password.mjs
  Guarded account maintenance tooling.

.github/workflows/dependency-lock-integrity.yml
  Guards package-lock drift after monitoring dependency failures exposed this risk.
```

---

## 3. Data Model & State Management

Most operational rows are scoped by `shopId`. IDs are UUIDs unless a legacy/business number is explicitly preserved. The database is not merely CRUD storage: several tables preserve historical financial and regulatory evidence and therefore must not be casually rewritten.

### Core operational models

| Model group | Purpose / invariants |
| --- | --- |
| `Shop` | Tenant/shop settings, taxes, labor defaults, shop supplies, invoice legal text, repair facility/technician defaults, lead notification settings, next RO number. |
| `ShopMembership` | Supabase Auth user-to-shop role mapping. Roles are OWNER/ADMIN/STAFF/MONITOR. |
| `Customer` | Master customer record. Includes `acquisitionSource` for `WEB`, `LEGACY`, `MANUAL`/other values plus legacy identifiers. Customer list shows Source. |
| `CustomerLegacyAlias` | Preserves legacy customer-number aliases and historical reconciliation links. |
| `Vehicle` | Customer-owned vehicle record with Y/M/M, engine, VIN, plate, odometer and legacy identity. |
| `RepairOrder` | Draft/open/invoiced/void operational estimate with customer/vehicle, mileage, concern/recommendation, totals, shop-supply snapshots, audit-preserving RO number. |
| `RepairOrderPart` / `RepairOrderLabor` | Estimate line items. Current DB also persists line ordering added during October UAT. Labor supports complimentary and shop-supply eligibility. |
| `Vendor` | Shop-scoped normalized vendor list used by part line typeahead. |
| `Invoice` | Historical/financial document linked to optional RO. Stores shop/customer/vehicle snapshots, invoice status/dates, totals, shop-supply snapshot, complaint/recommendation and payment state. |
| `InvoicePart` / `InvoiceLabor` | Frozen invoice line items. Invoice creation preserves RO line display order. |
| `InvoiceLegacyCharge` | Preserves imported legacy charge buckets/classification. |
| `Payment` | Multiple payments per invoice. Payer types include CUSTOMER, INSURANCE, WARRANTY, OTHER. |
| `AccountReceivable` | Current remaining invoice balance and paid/open state. |
| `MarketingLead` | Public inquiry with source, preferred contact, requested service, vehicle data, scheduling, attribution, linked `customerId`, `convertedAt`, and workflow status. |
| `MarketingLeadNotification` / `MarketingLeadNotificationRead` | One lead notification with per-user read state. |
| `MarketingSetting`, pages/services/coupons/testimonials/gallery | DB-backed public-site content. |
| `PublicLeadSubmission` | Anti-abuse ledger/fingerprint data; not the operational lead record. |
| `AuditLog` | Operational/governance trace where enabled or explicitly required. |
| `LegacyImportRun`, `raw_legacy_*`, `LegacyImportError` | Shopman32 staging, provenance and migration diagnostics. |

### Authorization and signature evidence subsystem

Customer authorization is now a first-class evidence subsystem added by the October migrations:

- `document_revisions`
  - `DocumentEvidenceType`: `REPAIR_ORDER` or `INVOICE`
  - canonical JSON snapshot
  - SHA-256 hash
  - revision number
  - financial total
  - append-oriented historical identity
- `authorization_requests`
  - tied to one document revision
  - random public token is stored hashed, not plaintext
  - pending/approved/declined/expired/revoked/superseded lifecycle
  - expiry and decision timestamps
- `authorization_events`
  - method: phone, email link, in-person signature
  - decision: approved, declined, delivery acknowledged
  - authorizer name and optional relationship/role
  - amounts discussed/authorized, notes, staff identity
  - consent text/version and request metadata where applicable
- `signature_evidence`
  - immutable signature artifact/data plus SHA-256 checksum
  - tied to the authorization event

Important current rule: **RO authorization validity is based on the approved financial total, not an exact match of every later nonfinancial snapshot field.** An unchanged total remains authorized; a changed estimate total requires reauthorization. This was an intentional UAT fix. Do not revert to “any text edit invalidates authorization” without an explicit product/regulatory decision.

Invoice creation normally requires `AUTHORIZED`. OWNER/ADMIN may override with a reason of 10–500 characters; the override is explicitly audit-logged as a governance event.

### Server/client state pattern

- Server Components own most persisted read state.
- Server Actions own writes and enforce permissions/shop scope.
- Prisma transactions protect multi-step financial/lead operations.
- Client React state is used for dialogs, editor state, dictation, signatures and validation feedback.
- There is no Redux-style global client store.
- Lead notifications poll and refresh on browser focus/visibility; read state is persisted per user.
- Sidebar collapsed state is browser-persisted via local storage and server markup begins collapsed.

---

## 4. Current Business Workflows & Feature State

### 4.1 Repair Orders

Current RO capabilities include:

- create against existing or new customer/vehicle
- allocate a durable RO number at creation
- Draft/Open editing
- change assigned customer or vehicle while the RO remains eligible
- inline **Edit Customer** and **Edit Vehicle** dialogs from the RO, reusing master-record edit actions
- current service mileage kept separate from vehicle master mileage
- customer and vehicle history controls, including restored **vehicle-scoped history** so a multi-vehicle customer can be narrowed to the current vehicle
- editable Customer Complaint and Service Recommendation cards with explicit save behavior
- internal customer/vehicle notes
- unified Parts/Labor editor with:
  - expandable description field rather than a cramped single-line input
  - historical description suggestions
  - vendor typeahead with matching vendors prioritized
  - default numeric values and no browser number spinners
  - complimentary labor
  - move/reorder controls with persistent DB order
  - speech dictation for supported text fields
- dictation remains listening until the user stops it and converts dictated text to uppercase, addressing UAT feedback about pauses and capitalization
- shop supplies calculation/override rules
- print/PDF/email estimate
- audited void instead of delete
- invoice conversion makes the RO read-only

The current RO detail page still renders **Customer and Vehicle as the two overview columns** at desktop widths. Do not rely on older mockups or discussion notes claiming that Vehicle was already moved under Customer unless the code is changed later.

### 4.2 Estimate authorization

Authorization UI is intentionally explicit:

- email action is framed as sending the estimate/authorization link
- verbal authorization is a separate short action
- verbal approval records authorizer identity/relationship, amounts, notes, staff identity and timestamp
- remote approval emails use a public one-time token route
- approval/decline is captured against a specific immutable document revision
- evidence history has a dedicated printable viewer
- remote requests can be expired/revoked/superseded and terminal decisions are protected from replay

Creating an invoice without authorization is blocked for normal staff. OWNER/ADMIN can proceed only through the explicit override path with a written reason.

### 4.3 Invoices, payments and delivery

Invoice detail has been redesigned for the owner's Windows laptop workflow:

- compact header actions
- **Job summary** card on the left/top area
- **Balance due** card beside it at wide screens
- customer complaint and shop recommendation are inside Job Summary rather than consuming a separate wide card
- balance/totals are deliberately rendered as vertical label/value rows to prevent print/PDF overlap
- responsive line-item list avoids the prior right-side amount clipping problem

Invoice functions include:

- edit while open
- preserved RO line order
- parts/labor/complimentary display
- shop supplies and tax
- PDF/print/email
- labor warranty, customer authorization and certification text sourced from the saved shop/invoice snapshot
- split/multiple payments
- payer type support including insurance/warranty/other
- payment cannot exceed current balance
- final payment closes the invoice and updates AR
- vehicle remains operationally unreleased until the complete balance is handled by the workflow
- void is retained/audited and is limited to eligible native open invoices with no payments

Delivery signature flow captures both:

- customer name/signature/consent
- shop representative name/signature/consent

with server timestamp and request metadata stored through the evidence subsystem. It is separate from facility certification text.

### 4.4 Customers and Vehicles

- active/archived/all lifecycle views
- search
- create/edit/archive/restore behavior
- inline edit from RO
- history and invoice/RO associations
- Customer list now includes **Source**:
  - `Web` for `acquisitionSource=WEB`
  - `Legacy` when imported/legacy-backed
  - `Manual` for normal native customers without a source marker

This source field is important for demonstrating website ROI.

### 4.5 Leads and website conversion tracking

Lead tabs remain:

- New
- Contacted
- Scheduled
- Converted
- Closed
- All

Current semantics:

- **New:** lead has arrived and has not yet been acted on
- **Contacted:** staff has made initial contact but no confirmed appointment exists
- **Scheduled:** confirmed shop date/time; date and time are required
- **Converted:** system-controlled after an RO is created for the linked customer
- **Closed:** lost/not proceeding; Internal Note is required as the lost reason

When a lead is changed to Scheduled:

1. PlumWorks validates the schedule.
2. It reuses a linked customer only if the linked record still matches the lead name.
3. If needed, it attempts matching by email+name or phone+name.
4. If no match exists, it creates a Customer and sets acquisition source `WEB`.
5. If Y/M/M exists, it creates the vehicle if that same customer does not already have a matching vehicle.
6. The lead is linked to the customer.
7. A scheduling notification email may be sent.

When an RO is later created for that linked customer, eligible New/Contacted/Scheduled leads are automatically marked Converted and `convertedAt` is set. This is the foundation for future Website → Customer → RO → Invoice revenue attribution.

### 4.6 Public website / marketing

Public website remains inside the application and includes:

- service pages
- reviews/photos/coupons/about
- appointment/contact/drop-off lead forms
- SEO sitemap/robots/legacy redirects
- Google Search Console-oriented canonical/redirect work
- DB-backed marketing content with explicit source fallbacks
- Turnstile plus honeypot, duplicate/rate/fingerprint controls
- required phone, email, preferred contact method and requested service on the hardened lead flows
- attribution capture such as campaign/referrer/click IDs where available

Do not treat fallback marketing copy as customer source-of-truth. A public page rendering successfully does not prove that the database or authenticated application is healthy; `/api/health` and authenticated smoke checks exist for that reason.

### 4.7 Dashboard / reports / AR

Dashboard includes business operational metrics such as open ROs, customer/vehicle counts, invoice activity, leads and business overview metrics. Reports must continue using the explicit reportable-sales rules rather than counting open ROs or draft invoices.

Financial control totals historically reconciled and must remain protected:

- January 2026 gross: **$13,608.61**
- Q1 2026 gross: **$48,908.49**
- H1 2026 gross: **$130,599.15**
- 2025 gross: **$273,292.61**

Any report, import, void, payment, charge-classification or sold-date change must be reconciled to these controls and the current database before release.

---

## 5. Environment, Commands, Deployment & Monitoring

### Local development safety

Use `.env.development.local` only for the approved DEV Supabase target. `npm run dev` is intentionally guarded by `scripts/dev-database-command.mjs`; do not replace it with an unguarded `next dev` workflow for normal development.

Typical guarded development sequence:

```bash
npm ci --ignore-scripts
npm run db:dev:status
npm run db:dev:migrate
npm run prisma:dev:generate
npm run dev

npm run lint
npx tsc --noEmit
npm run build
npm run test:monitoring
npm run test:seo
```

For a deliberately selected migration/deployment target using reviewed `.env.local`:

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:migrations:verify-security
```

Never run `prisma migrate dev` or `db push` against production.

### Useful account/admin scripts

```bash
npm run user:dev:create
npm run user:dev:rename
npm run password:dev
npm run password:prod
```

These exist because account testing/owner email/password issues have occurred during UAT; keep them environment-guarded and do not embed credentials in source.

### Legacy cutover tooling

The repository contains rehearsed legacy refresh/cutover, backup and verification commands. Before any final migration/cutover work, inspect the current versions of:

- `scripts/legacy-refresh-rehearsal.mjs`
- `scripts/legacy-cutover.mjs`
- `scripts/lib/legacy-cutover-reset.mjs`
- `scripts/lib/public-db-backup.mjs`
- `docs/cutover-runbook.md`

Recent changes added cutover-readiness tests and updated reset/rehearsal logic to account for new application tables/fields. Do not assume the October authorization/lead schema can be ignored by an older migration script.

### Production monitoring

Monitoring consists of:

- bearer-protected `/api/health` database health check
- public page smoke checks
- login and authenticated module navigation checks
- sanitized timing/result artifact
- Resend email health report
- Better Stack heartbeat/failure heartbeat
- fallback failure email path that does not depend on the normal app reporting import tree

The current GitHub workflow `.github/workflows/cardoc-production-health.yml` is **`workflow_dispatch` only**; scheduling is external to this YAML. Earlier operations moved the daily trigger outside native GitHub schedule handling. Therefore a future AI must not “fix” the missing `schedule:` block without first checking the external scheduler and the GitHub Actions run history.

The monitoring workflow was hardened again on **2026-10-22/23** after production monitoring failures:

- health endpoint accessibility through the proxy was restored
- reporter/heartbeat paths were decoupled from fragile application imports
- fallback alerts can be sent directly through Resend
- Better Stack `/fail` heartbeat is used on incomplete runs
- lockfile drift is now guarded by dedicated CI
- the normal success heartbeat occurs only after tests **and** report delivery succeed

Monitoring remains an operational requirement: a green deployment is not equivalent to successful login/email/heartbeat monitoring.

### Branch note as of this snapshot

`main` is the current source baseline. The `dev` branch is currently **behind main and diverged**, with only one dev-only login-file commit ahead while main contains many subsequent production commits. Do not build new work on `dev` without first reconciling/rebasing/resetting it intentionally; otherwise later merges can resurrect stale code.

---

## 6. Critical Gotchas / “Do Not Break” Rules

1. **Authorization evidence is regulatory/audit data.** Do not add normal edit/delete APIs for document revisions, authorization events or signature evidence. Corrections should be append-only/new evidence where possible.
2. **Authorization readiness is currently total-based.** Approval remains valid when nonfinancial text changes but estimate total remains the same. A total change requires reauthorization. This behavior was deliberately corrected during UAT.
3. **Invoice creation authorization override is privileged.** OWNER/ADMIN only, mandatory reason, governance audit entry.
4. **Do not mutate invoice historical snapshots when master records/settings change.** Customer/vehicle/shop legal text on an existing invoice must continue to reflect the frozen document context.
5. **Keep customer acquisition attribution.** Scheduling website leads and later RO creation now automate Web source and conversion. Do not regress this back to manual Converted clicks.
6. **Keep lead Converted system-controlled.** Staff can work New/Contacted/Scheduled/Closed; RO creation owns conversion.
7. **Preserve customer/vehicle historical ownership semantics.** Changing a vehicle owner today must not rewrite old invoice/customer history.
8. **Preserve void auditability.** RO/invoice numbers are not recycled; void records remain visible for audit/report rules.
9. **Preserve split-payment transaction integrity.** Payment, AR balance, paid total and close state must remain transactional.
10. **Protect reconciled report logic.** Native closed-date versus imported invoice-date semantics are intentional.
11. **Keep vehicle-specific RO history.** The owner explicitly requested vehicle history separate from overall customer history for multi-vehicle customers; this was restored on 2026-10-22.
12. **Do not undo the UAT dictation behavior.** Speech input intentionally continues through pauses until stopped and produces uppercase text.
13. **Do not lose line ordering.** RO parts/labor order is persisted and propagated into invoices. Any new save/revision logic must keep position stable.
14. **Keep section saves separate from financial draft revisioning.** UAT exposed unwanted interactions between saving concern/recommendation sections and authorization revision state; this was fixed.
15. **Keep responsive Windows layout constraints in mind.** The owner's primary device is an HP Pavilion/Windows laptop. Avoid wide right-side panels or amount columns that become clipped at common laptop widths.
16. **PDF/HTML/onscreen invoice layouts are separate surfaces.** If totals or legal copy are changed, verify detail page, print HTML and emailed/generated PDF. October fixes were required because totals could overlap in print/PDF even when screen UI looked correct.
17. **Email in DEV must remain safe.** `src/lib/email/dev-email-safety.ts` exists to prevent accidental real-customer delivery from development workflows.
18. **Do not bypass `shopId` and permission checks.** UI hiding is not authorization.
19. **MONITOR stays read-only.** Monitoring credentials must never gain mutation permissions.
20. **Do not casually replay legacy import/cutover scripts.** They operate on financial and historical data and require current backups/rehearsals.
21. **Do not commit legacy/customer raw data.** Follow `AGENTS.md`; keep Windows application artifacts and extracted customer files out of the shared source.
22. **Do not change framework/Prisma versions as incidental cleanup.** Next 16/React 19/Prisma 7 behavior is part of the tested baseline.
23. **Dependency lockfile is now operationally important.** Monitoring failed when `package.json` and `package-lock.json` drifted; keep them synchronized.
24. **Public marketing fallbacks can mask a DB problem.** Always distinguish public render success from application/database health.

---

## 7. Current UAT / Near-Term Priorities

The application is in late UAT/cutover-preparation mode, not early feature prototyping. Prioritize regression safety and owner workflow over broad refactors.

### Highest-priority verification areas

1. **Complete UAT sign-off** across RO, authorization, Invoice, customer/vehicle, lead, payments/AR, reports, website forms, and print/email/PDF surfaces.
2. **Cutover readiness audit** against the still-used Windows application, including the refreshed migration scripts and all schema changes added since the earlier rehearsal.
3. **Authorization evidence end-to-end:** verbal, emailed approval, changed-total reauthorization, OWNER/ADMIN override, evidence viewer/print, and invoice delivery signatures.
4. **Windows laptop responsive behavior:** no clipped amount columns, line item controls, dialogs or invoice totals around typical Pavilion viewport widths.
5. **Production email flows:** estimate authorization email, normal estimate email, invoice email, lead notification/scheduling email, password/reset flows.
6. **Production monitoring reliability:** verify real scheduled trigger, report delivery, login timings, Better Stack success/failure signaling, and fallback alert behavior.
7. **Lead revenue attribution:** confirm Web customer source, lead conversion on RO creation, and future dashboard/reporting from Lead → Customer → RO/Invoice revenue without manual status work.
8. **Disaster/recovery plan:** continue the planned 1–2 day Vercel/Supabase outage contingency work; database dump alone is not a complete Supabase Auth/Storage recovery strategy.

### Git/GitHub working discipline

Before making a new change:

1. inspect `main` HEAD and the deployed Vercel SHA
2. inspect `git status` locally
3. reconcile the stale/diverged `dev` branch before relying on it
4. inspect pending Prisma migrations against the intended environment
5. make focused changes on a reviewable branch where appropriate
6. run targeted tests plus lint/type/build for material changes
7. test on `plumworks-dev`
8. promote only after UAT acceptance
9. verify the actual production deployment and real owner workflow
10. update this `PROJECT_CONTEXT.md` whenever a change materially alters architecture, data model, compliance evidence, business workflow, deployment, monitoring, or cutover behavior

---

## Final handoff summary

The most important change since the prior Project Context is that PlumWorks is no longer just an RO/Invoice CRUD replacement for the Windows app. It now contains **auditable customer authorization, remote approval, delivery signatures, web-lead/customer conversion attribution, inline RO master-record editing, persistent UAT-oriented line-entry behavior, and hardened operational monitoring**. Those subsystems are now part of the application's core invariants.

When source code, old chat notes and old documentation disagree, treat the current `main` source and current migrations as the technical truth, then verify production deployment/live data before making operational claims.
