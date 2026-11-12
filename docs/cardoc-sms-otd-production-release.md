# Car Doc release: SMS consent, text authorization and Out-the-Door pricing

**Target:** `main` / Production. Source: selective release branch `release/sms-consent-otd-20261111` based on `main`, not a merge of `dev`.

**Deployment gate:** This document is a runbook, not approval to enable outbound customer texting or change Twilio callbacks. Do not apply Production SQL migrations without a verified backup and a successful migration preflight. Keep all SMS toggles `false` through first deployment.

## Included changes

- Out-the-Door quote preview / reverse-calculation, per-line price allocation and atomic RO line creation; responsive review modal, Back to Edit, Create RO Lines & Save.
- SMS customer consent: iPad handoff and customer QR+PIN, disclosure, consent history and status, decline, return to the originating RO.
- Text estimate authorization using the same revisioned evidence/decision flow as email, SMS delivery callbacks, sender mapping, STOP/HELP and carrier-verified START, per-shop suppression and rate limits.
- Only SMS-related changes to existing RO, Customer and authorization screens, SMS Terms / proof / Privacy content.
- Five SMS-only SQL migrations: `20261105190000_add_sms_authorization_channel`, `20261108150000_add_sms_consent_foundation`, `20261108190000_add_sms_consent_declined_event`, `20261109231000_add_sms_inbound_optout_diagnostic`, `20261109233000_sms_verified_start_reenrollment`.

**Intentionally excluded:** unrelated invoice categorized discounts and its migration, System Health telemetry and its migration, unrelated Dev UI, SEO, favicon, and deferred-work issue #154.

## Blockers to resolve before Production deployment

1. Verify Production Supabase identity and migration history. The connected Supabase account used for release preparation currently exposes `plumworks-dev` and a restore rehearsal project but **not** Car Doc's Production database.
2. Run/verify an independent restorable Production database backup. Do not infer backup status from a successful Dev migration.
3. Ensure the official Production `DATABASE_URL` / `DIRECT_URL` target the right project using the existing production fingerprint guard before running Prisma migrate deploy. Compare migration history and confirm the five SMS migrations are the **only** pending ones. If any other migration is pending, stop and investigate.
4. Verify Production Twilio credentials exist without printing values, and check campaign approved and number `+15869325090` REGISTERED.
5. Verify the final Preview build and run the focused authorization, consent, and Out-the-Door regression/UAT checks on a staging database. A Next.js build does not replace those tests.

## Production environment variables

Preconfigured on Vercel Production:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_SMS_FROM=+15869325090`
- `SMS_APPROVAL_ORIGIN=https://app.subbuscardoc.com`
- `SMS_TWILIO_WEBHOOK_URL=https://app.subbuscardoc.com/api/sms/inbound`
- `SMS_TWILIO_STATUS_URL=https://app.subbuscardoc.com/api/sms/status`
- `SMS_PROD_DAILY_LIMIT=25`
- **`SMS_SEND_ENABLED=false`**
- **`SMS_CONSENT_ENABLED=false`**
- **`NEXT_PUBLIC_SMS_UI_ENABLED=false`**

No `SMS_DEV_*` or `TWILIO_API_KEY_*` variables are needed for the Production release. Dedicated Twilio API keys remain a possible future security enhancement, not a prerequisite to the tested SID/Auth Token method. Never log secrets.

## Safe deployment sequence

1. Approve the exact release commit and its Preview build. Confirm the GitHub PR contains no unreviewed feature files and `main` has not moved.
2. Verify Production backup and migration status. Apply reviewed SMS-only migrations through the established fingerprint-guarded Production migration procedure. Verify tables, constraints and enum exist, and only then create the sender mapping using the **real Production shop ID** for `+15869325090`.
3. Merge/release after migration is verified. Confirm Production deployment is READY and existing app flows still function, **with all SMS flags off**.
4. Test Out-the-Door pricing with a new **test** RO and confirm exact quoted totals, RO line generation, tax/shop supplies, invoice consistency, and rollback on save error. Test existing RO/Invoice paths.
5. Configure a controlled Production test phone with documented consent. Enable **consent** and public SMS UI, redeploy, confirm signed customer-facing consent routes work and no messages send.
6. Schedule Twilio webhook cutover from `https://dev.subbuscardoc.com/api/sms/inbound` to `https://app.subbuscardoc.com/api/sms/inbound` within the approved Messaging Service. Do not allow a gap in handling STOP/HELP/START. Disable Dev sends at cutover.
7. Enable Production `SMS_SEND_ENABLED=true` only with an explicit go-live decision. Redeploy, send one controlled consented test message, confirm signed status callbacks, delivery status, customer approval and evidence, and STOP/HELP/verified START.
8. Monitor delivery failures, Twilio logs, webhook failures, and shop SMS limit. No bulk texting until checks are complete.

## Rollback / incident

- First disable `SMS_SEND_ENABLED` and redeploy; this immediately prevents further outbound messages.
- Keep inbound webhook operational to process STOP, even when outbound is disabled. Do not blindly repoint it to an environment that lacks the sender mapping.
- If a code rollback is needed, preserve required SMS tables and consent/suppression records; do not drop them as an automatic rollback.
- Investigate failed signed callback handling before resuming sending. Preserve audit/evidence history.

## Acceptance report

Record evidence for each gate: Production DB identity, backup confirmation, exact pending migration list, migration results, build SHA, Out-the-Door totals, consent/STOP/HELP/START checks, SMS approval evidence, Twilio callback routing, feature-flag states, and final explicit approval.