# Public lead forms: local implementation and rollout

Applies to `/contact`, `/appointment`, and `/drop-off`. No legacy import or historical lead rewrite. No new lead status. Existing notifications, recipient settings, attribution, lead cards, and status workflow are retained. The separate call-click tracker still records its fixed system message; it accepts no submitted message/service content and remains outside this three-form workflow.

## Public fields

All fields below are required unless marked optional.

| Form | Fields |
| --- | --- |
| Contact | Name, Phone, Email, Preferred Contact Method, Requested Service |
| Appointment | Name, Phone, Email, Preferred Contact Method, Vehicle Year, Vehicle Make, Vehicle Model, Preferred Date, Preferred Time (optional), Requested Service |
| Drop-Off | Name, Phone, Email, Preferred Contact Method, Vehicle Year, Vehicle Make, Vehicle Model, Preferred Drop-Off Date, Requested Service |

Preferred Contact Method has Text, Phone Call, and Email radio options, with no preselected answer. All three forms include Turnstile and the explanation: “Choose the option that best fits. We'll contact you using your preferred method to get the details and determine the next step.” No multiline or general message input remains.

The service dropdown and backend use `src/lib/marketing-requested-services.ts`:

| Submitted value | Displayed/stored label |
| --- | --- |
| diagnostics | Warning Light / Diagnostics |
| oil-filter | Oil & Filter Service |
| brakes | Brake Inspection / Service |
| maintenance | Scheduled Maintenance |
| climate-cooling | A/C, Heating & Cooling |
| battery-electrical | Battery, Starting & Electrical |
| steering-suspension | Steering & Suspension |
| transmission-clutch | Transmission & Clutch |
| engine | Engine Concern / Repair |
| undercar | Undercar Inspection / Service |
| other | Other / Not Sure |

The server stores canonical labels so existing internal views and email templates remain readable without changing historical service strings. Every new form lead has `message: null`. Unknown fields, including message, notes, concern, symptoms, internal notes and status, are rejected; they are never spread into lead data. React's action transport metadata is ignored. A populated honeypot short-circuits to generic success and stores nothing, even if other fields are malformed.

Request Service retains its navigation entry. `/appointment` now begins with two responsive cards: Request an Appointment (jumps to the form below) and Plan a Vehicle Drop-Off (links to `/drop-off`). Drop-off displays confirmation/approved-instructions requirements above the form, at submission, and on success. Submission never authorizes leaving keys or a vehicle.

## Vercel environment configuration (later, before enabling submissions)

| Variable | Visibility | Value to configure |
| --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Public, build-time | Your Cloudflare Turnstile widget site key |
| `TURNSTILE_SECRET_KEY` | Server only | Matching Cloudflare widget secret |
| `TURNSTILE_ALLOWED_HOSTNAMES` | Server only | Comma-separated exact allowed hostnames, e.g. `www.subbuscardoc.com,subbuscardoc.com`; no scheme/path |
| `LEAD_ABUSE_HASH_SECRET` | Server only | Cryptographically random stable secret of at least 32 characters; generate with `openssl rand -hex 32` |

Existing `DATABASE_URL`, `DIRECT_URL`, and email configuration/settings retain their roles. No paid service or package dependency was added. The Vercel-provided `VERCEL=1` enables trusted client-IP extraction. No manual VERCEL variable is needed. Configure the same approved domains in the Cloudflare widget dashboard. Give preview environments their own appropriate keys/allowed hosts; do not whitelist arbitrary incoming Host headers. Updating the public key requires a rebuild.

Missing configuration fails closed. The secret keys never enter client modules. Keep the hashing secret stable across instances/releases: rotation invalidates form stamps and the current 30-minute duplicate/rate history. Do not set test keys in production.

## Protection order and implementation

1. **Honeypot:** hidden `website` input, inside `aria-hidden`, removed from tab order, autocomplete off. A nonempty value returns the normal success redirect without verification, DB writes, owner email, notifications, or counts.
2. **Strict validation:** reject unknown/repeated fields, uploaded files, control characters, overly long values, and more than 8 KiB of decoded field names/values or 30 entries. Next.js also retains its default Server Action transport body limit. No silent truncation. Name max 120, phone max 40 with existing North American validation and normalization to 10 digits, email max 200 and lowercased, make/model max 80 with spaces/common punctuation permitted. Year must be four digits, 1900 through current year + 2. Dates must round-trip as real calendar dates and have a reasonable year; optional appointment time must be `HH:mm`.
3. **Completion stamp:** server signs form type, render timestamp, and nonce using HMAC-SHA256. Require at least 500 ms since rendering; seven-day expiry. Missing/tampered/future stamps fail. This is supplemental, never a substitute for Turnstile. The submit button also waits 500 ms after mounting, so instant autofill does not trip the minimum.
4. **Turnstile:** shared explicitly rendered component uses the public site key and action `CONTACT`, `APPOINTMENT`, or `DROP_OFF`. Use compact mode in containers under 300 px and flexible mode otherwise. Server POSTs the token and server-only secret to Siteverify with no caching and an 8-second timeout, then requires `success === true`, an approved hostname, and the matching action. Missing/invalid/expired/replayed tokens, network failures, malformed responses, hostname/action mismatches, and absent secrets cannot reach storage. The form shows a friendly retry message and mounts a fresh widget after a failed submission redirect. A submit event invalidates the current client verification state; if the same widget remains mounted when the request finishes, it is reset for a fresh token. Expiration exposes an explicit retry control. Cloudflare enforces single-use tokens with a five-minute lifetime ([Siteverify documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)).
5. **Atomic admission and creation:** `publicLeadAdmission` runs inside the existing `storeMarketingLead` transaction before lead or notification insertion. Transaction isolation is explicitly READ COMMITTED. A transaction-scoped Postgres advisory lock derived from shop ID serializes this short critical section across Vercel instances; no process-memory lock or session-level database lock is used. The clock is read from Postgres after acquiring the lock, explicitly converted to UTC before Prisma decodes it so non-UTC database sessions cannot shift timestamps.
6. **Duplicate first:** HMAC-SHA256 fingerprint over shop, form type, normalized email/phone, canonical service label, vehicle year, normalized lowercase make/model, date and time. Trim/collapse whitespace before fingerprinting. Name and contact preference are deliberately not distinguishing fields. A previous successful equivalent request within the rolling 30-minute window returns ordinary success with no additional writes/delivery; different form types remain distinct. A fresh valid Turnstile token is still required for a repeated form submission; a reused invalid token fails verification and also creates nothing.
7. **Rate limits:** rolling accepted-submission limits shared across all three forms within each shop: IP 5/10 minutes, email 3/30 minutes, phone 3/30 minutes. Check all three after duplicate detection, then reserve one ledger row only for an accepted new lead. Duplicates, validation failures, honeypots, verification failures and rate-limited requests do not consume accepted-submission quota. Public errors reveal neither identifier nor threshold. Vercel's platform-overwritten `x-vercel-forwarded-for` is the only trusted header; local development uses a single shared bucket. IPv6 spelling is canonicalized. ([Vercel request headers](https://vercel.com/docs/headers/request-headers))
8. **Workflow:** ledger reservation, MarketingLead and optional bell notification commit together. Any failure rolls all three back. Owner email runs once after commit using existing settings; delivery failure does not undo the accepted lead. Existing dashboard/read/toast/status behavior follows the committed rows.

The separate `public_lead_submissions` table contains shop ID, HMAC digests, and timestamp only—no raw IP/email/phone, message, rejected submissions, or customer story. Each committing admission transaction (including successful duplicates) removes at most 100 rows whose timestamp is at least 30 minutes old, selecting oldest IDs via the existing `(shop_id, created_at)` index and deleting only those IDs under the same shop lock. Active queries use timestamps strictly newer than their cutoff, so cleanup never weakens a live window. Each new submission adds at most one row while cleanup drains up to 100; an idle shop may retain expired hashes until activity resumes. Rejected/spam requests insert no ledger rows, and cleanup rolls back if the transaction fails. No raw IP is stored. Historical leads are never cleaned up by this process.

## Database migration to apply later

`prisma/migrations/20260924120000_public_lead_protection/migration.sql` adds only `public_lead_submissions`, its five lookup indexes, and a shop foreign key. RLS is enabled and all anon/authenticated table permissions revoked. Prisma runtime credentials access it server-side, as with the existing lead pipeline. No changes to `MarketingLead` columns or old rows; drop-off reuses `preferred_date`.

Apply this migration using the existing migration deployment process against the intended environment **before deploying/enabling this form code**. `npm run prisma:migrate:deploy` uses the configured `DIRECT_URL`; verify its target before running. No production migration has been run as part of implementation. Do not use `db push` in production.

## Tests and local reproduction

- `node --test tests/public-lead-protection.test.mjs`: service allowlist, all form actions, injections/limits, normalization, signed time, mocked Turnstile outcomes, zero effects on blocking, rolling quotas/expiry, duplicates and responsive structure.
- `node --test tests/public-lead-protection.test.mjs tests/marketing*.test.mjs tests/operational-leads.test.mjs tests/lead-*.test.mjs`: relevant public/lead regression suite, including historical message rendering and existing notifications/status behavior.
- `PUBLIC_LEAD_TEST_DATABASE_URL=postgresql://...@127.0.0.1:55439/cardoc_public_leads_test node --test tests/public-lead-postgres.test.mjs`: opt-in real Postgres migration, RLS, independent-connection races, quotas, rollback and unchanged historical records. Requires a disposable DB with the current Prisma schema. Refuses nonlocal URLs and other database names. Recreates **only the synthetic protection table in that test database**, creates synthetic shops, and removes them afterwards. Without the explicit URL this test is skipped.
- `scripts/verify-public-lead-forms-browser.mjs <installed-playwright-module-path> [http://127.0.0.1:3119]`: opt-in Playwright run, with the same test DB variable. Requires an otherwise empty synthetic database and a local test app bound with `--hostname 127.0.0.1` (so Next.js dev hydration is allowed) whose Siteverify fetch is mocked: `synthetic-SOURCE` returns success with hostname `127.0.0.1` and action SOURCE. Block other external fetches, disable email credentials/settings, and use loopback-only app database configuration. The script mocks the browser widget; no real Cloudflare call is made. It covers 320/390/1280px layouts, compact/flexible widget sizing, discoverability, actual Server Action transport, all legitimate paths, case/phone duplicates, direct message injection, failed-token retry and honeypots. It removes its synthetic shop afterwards.

Unit fixtures use Cloudflare's documented dummy keys and mocked Siteverify/widget responses, never production keys or live challenges. See [Cloudflare testing documentation](https://developers.cloudflare.com/turnstile/troubleshooting/testing/). No real customer data is used.

## Initial implementation validation results (before focused audit)

- Focused protection tests: **66 passed**.
- Full relevant marketing/lead suite: **237 passed**, zero failures.
- Real isolated Postgres migration/concurrency suite: **passed** with two independent Prisma connections.
- Local Playwright: **passed** at 320, 390, and 1280 px, using mocked widget/Siteverify and synthetic records. Screenshot inspected at 320 px; no horizontal overflow.
- TypeScript `npx tsc --noEmit`: **passed**.
- Prisma schema validation and client generation: **passed**.
- Production `npm run build`: **passed**, with all database settings overridden to the disposable local database. Turbopack initially needed sandbox permission to bind a local port; the permitted build succeeded.
- Lint for all changed TypeScript/JavaScript files: **passed**. Repository-wide `npm run lint` still reports the pre-existing `react-hooks/set-state-in-effect` error at `src/app/(app)/admin/app-settings/page.tsx:37`; that file is unchanged.
- `node --test tests/*.test.mjs`: **522 passed, 17 failed, 1 skipped**. All 17 failures reproduce on the original HEAD sources. The opt-in Postgres test is skipped in this command and was separately run successfully with its explicit local URL.

Unrelated pre-existing full-suite failures:

- Invoice and Repair Order import the exact shared responsive row presentation
- Invoice print, PDF, and email models distinguish partial payment from Paid
- Invoice status, Email, and Print share one aligned action row without a status placeholder
- Labor retains Common Services alongside historical free-text search without immediate persistence
- Parts has exactly one reusable draft row and one Add Part action
- Repair Order detail exposes an aligned Status, History, Email, Print action row
- customer-facing Invoice detail, print, PDF, and email document model omit Vendor
- dashboard renders exactly the five requested summary cards
- finalization preserves the explicit complimentary identity
- monthly invoices use one shop-scoped aggregate over stored total
- record actions are secondary and route to the correct internal record
- rows are responsive, accessible, independent forms with no horizontal scroller
- shared accessible picker debounces, protects against stale responses, and preserves free text
- standalone creation reuses authorization and detects archived VIN conflicts
- standalone, Customer Add Vehicle, edit, and New RO creation paths persist Engine
- summary is allocated real space and stacks before line controls can overflow
- surrounding workflow and server-authoritative calculations are unchanged

## Files changed

- `.env.example`
- `docs/public-lead-protection.md`
- `prisma/migrations/20260924120000_public_lead_protection/migration.sql`
- `prisma/schema.prisma`
- `scripts/verify-public-lead-forms-browser.mjs`
- `src/app/(marketing)/appointment/page.tsx`
- `src/app/(marketing)/contact/page.tsx`
- `src/app/(marketing)/drop-off/page.tsx`
- `src/app/(marketing)/lead-actions.ts`
- `src/app/(marketing)/page.tsx`
- `src/app/(marketing)/services/[slug]/page.tsx`
- `src/app/(marketing)/services/page.tsx`
- `src/components/marketing/lead-form.tsx`
- `src/components/marketing/lead-verification.tsx`
- `src/lib/marketing-content.ts`
- `src/lib/marketing-lead-submission.ts`
- `src/lib/marketing-requested-services.ts`
- `src/lib/public-lead-admission.ts`
- `src/lib/public-lead-validation.ts`
- `src/lib/public-lead-verification.ts`
- `tests/helpers/public-lead-loader.mjs`
- `tests/marketing-homepage.test.mjs`
- `tests/marketing-lead-notifications.test.mjs`
- `tests/marketing-service-content.test.mjs`
- `tests/operational-leads.test.mjs`
- `tests/public-lead-postgres.test.mjs`
- `tests/public-lead-protection.test.mjs`
- `tests/public-lead-retry.test.mjs`

No commit, push, deployment, production-data change, or production migration was performed. `OriginalWinApp/` was not modified. Database writes and migration rehearsal were limited to the disposable loopback database with synthetic data.


## Focused pre-commit audit

Findings corrected:

- Homepage/service CTAs and service-directory intake guidance still implied narrative web input. These now use application-owned structured-request instructions, so old database/deployment marketing text cannot contradict the current form contract. Only intake display fields changed; stored marketing records, educational diagnosis content, phone links, and verbal follow-up instructions were not modified. The unused Contact fallback also no longer says “send a note.”
- Retention existed but used an unbounded delete. It now selects at most 100 expired IDs using the indexed timestamp before deleting them under the existing transaction lock.
- A new backlog test caught non-UTC raw timestamp decoding losing the database offset. The database clock query now explicitly returns UTC. Regression uses `America/Detroit` sessions and verifies real current UTC timestamps, bounded backlog removal, and preservation of active markers.
- Same-mounted-page submission completion now resets Turnstile after invalidating the submitted verification state. Expiration also exposes a retry button. Existing error redirects already remounted a fresh keyed widget.

Final processing order:

1. Next.js applies its Server Action transport/body constraints.
2. Populated honeypot exits with generic success and zero effects.
3. Payload/schema validation, including allowlisted service and normalized contact fields.
4. Signed form-completion timing check.
5. Server-side Turnstile Siteverify: success, exact configured hostname, expected form action. Invalid, expired or replayed tokens stop here.
6. Resolve the Vercel client IP, shop, and existing attribution.
7. Begin READ COMMITTED transaction; acquire the shop-derived advisory transaction lock; read database UTC time.
8. Bounded expired-ledger cleanup.
9. Check the successful-submission fingerprint for a duplicate within 30 minutes; return normal success without new lead/notification/email if found.
10. Check rolling accepted-submission quotas: IP 5/10 minutes, email 3/30 minutes, phone 3/30 minutes.
11. Insert ledger reservation, create MarketingLead, create bell notification if enabled, and commit atomically.
12. Send owner email according to existing settings after commit; return normal success.

Rate-limit ordering is unchanged: unverified submissions never consume email, phone, or IP accepted-submission quota. Repeated victim email/phone input without successful bot verification cannot lock that person out. IP enforcement remains 5 accepted new submissions per 10 minutes; it is not a pre-Siteverify attempt throttle. No process-memory mechanism was introduced.

All equivalent fingerprints within a shop use the same shop lock key. The lock and duplicate decision run in the transaction that inserts the successful marker and lead, so competing requests cannot both commit a duplicate. Lead or bell-insertion failures roll back both lead and marker; a later retry can create one committed lead. Email failures occur after commit, so the marker suppresses duplicate creation on retries within the window. Attempted/failed submissions never become successful markers.

The honeypot remains a display-none, aria-hidden text input with tabIndex -1 and autocomplete off. There are no login/password fields or ordinary user interactions that would populate it. No realistic default browser/password-manager autofill issue was found; behavior remains unchanged. Third-party tools that disregard visibility/autocomplete cannot be universally controlled.

Production hostname configuration has no localhost, wildcard, incoming-Host, or Vercel-preview fallback. Only explicitly configured exact hostnames are accepted. Server-only imports protect both secret keys.

Public pages with changed visible copy in this audit:

- `/`
- `/services`
- `/services/diagnostics`
- `/services/oil-change`
- `/services/brakes`
- `/services/scheduled-maintenance`
- `/services/ac-heating-cooling`
- `/services/battery-electrical`
- `/services/steering-suspension`
- `/services/transmission-clutch`
- `/services/engine-repair`
- `/services/undercar-service`

Focused audit validation:

- Last Python edit to `tests/public-lead-postgres.test.mjs` verified complete and syntax-valid before continuing.
- 125 tests passed: public protection, widget retry lifecycle, homepage copy, service copy rendering with stale stored CTA text, and existing lead notifications.
- Real isolated Postgres test passed after the UTC fix: independent connections, rate limits, a 250-row expired backlog removed in batches of 100/100/50, active markers preserved, rollback, RLS, and historical-data preservation.
- TypeScript typecheck, lint of all production/test files changed during the audit, production build, and diff whitespace check passed.
- The full suite and full browser suite were not rerun. Previously saved HEAD-baseline logs confirm all 17 reported full-suite failures existed before implementation; no unmatched failure names. The repository lint-error file is byte-identical to HEAD.
- `OriginalWinApp/` has no tracked or untracked changes. No unrelated files were changed. Changes remain limited to the public lead work, public intake copy, regression tests, and documentation.
- No commit, push, deployment, production migration, or production-data modification occurred. Only the existing disposable loopback database was used.
