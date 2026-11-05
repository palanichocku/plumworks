# Estimate SMS authorization — development-only delivery foundation

Branch: `feature/dev-sms-estimate-authorization`

## Rollout constraints

- NEVER send SMS to actual Car Doc customers during development.
- Never add real Twilio credentials to Git, client-side JavaScript, or production environment settings.
- Local development must use `.env.development.local` and the existing development-only database guard.
- The dev sender and destination must belong to, and be consented to by, the developer.
- Preserve email approval, verbal approval, invoice creation, and existing authorization audit evidence unchanged until the SMS workflow has completed regression testing.
- Do not set `SMS_DEV_SEND_ENABLED=true` in Production. Sending is explicitly blocked when `VERCEL_ENV=production`.

## Dev credentials (server-only)

```
SMS_DEV_SEND_ENABLED=false
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM=
SMS_DEV_ALLOWED_TO=
# For the restricted trial, use the predefined sample message identifier:
SMS_DEV_TEST_BODY=sms_appointment_reminders
```

Twilio trial restrictions may prevent sending custom authorization text, even to verified test numbers. A paid and appropriately registered sender may be required before end-to-end live SMS can be tested.

## Safe provider connectivity smoke test

After rotating the exposed Auth Token, configure the above variables in the existing local `.env.development.local` (do not commit the file). Set `SMS_DEV_ALLOWED_TO` to **your own verified phone**, never to a customer. Leave `SMS_DEV_SEND_ENABLED=false` until actively conducting a test.

To intentionally submit one development test message:

```bash
cd ~/Projects/Web/plumworks
git fetch origin
git switch feature/dev-sms-estimate-authorization
SMS_DEV_SEND_ENABLED=true node --env-file=.env.development.local scripts/test-dev-sms.mjs
```

The command reports acceptance by the provider, NOT actual delivery. The `sms_appointment_reminders` template identifier is only for the restricted trial, and is **not** a custom estimate message.

## Foundation status

- [x] Provider-independent SMS sender interface.
- [x] Twilio adapter with API response handling and no sensitive response logging.
- [x] Explicit development-only real-send guard.
- [x] Manual, opt-in Twilio API connectivity test script (not executed against real credentials).
- [ ] Dedicated authorization request channel and source metadata in the database. **Important:** the current public authorization decision records `EMAIL_LINK` unconditionally. Do not reuse it for SMS until it properly records `SMS_LINK`.
- [ ] Per-shop sender configuration and opt-in/opt-out record.
- [ ] Request lifecycle, idempotency, protected sending server action, rate limiting and spend caps.
- [ ] Secure origin validation (do not trust unvalidated forwarded host headers for approval URLs).
- [ ] UI 'Text Estimate' control, recipient review, and status/history.
- [ ] Delivery webhook verification, duplicate handling, and failure/retry semantics.
- [ ] Dev DB migration and development smoke tests with a fake provider.
- [ ] Real Twilio-to-test-phone and approval-evidence end-to-end test.
- [ ] Owner UAT and approval.
- [ ] Production migration + feature OFF, then separate go-live after registration, consent, and owner signoff.

## Go-live rule

A merge into `main` is NOT authorization to send production SMS. Feature must fail closed until explicitly activated after owner approval. Do not migrate test numbers, messages, or development credentials into production.


## Integrated Text Estimate development workflow (November 5)

The feature branch contains a **Dev-only** `Text Estimate (Dev)` button, a protected server action, and a migration for SMS authorization provenance. This is NOT a production-ready messaging service.

1. Migrate only the **development** database with `npm run db:dev:migrate` after confirming the dev project fingerprint.
2. For local development, add the following entries to `.env.development.local`:

```dotenv
NEXT_PUBLIC_SMS_DEV_UI_ENABLED=true
SMS_DEV_SEND_ENABLED=false
SMS_DEV_ALLOWED_TO=+1YOUR_OWN_VERIFIED_NUMBER
SMS_DEV_APPROVAL_ORIGIN=https://YOUR-REACHABLE-DEV-HOST
TWILIO_SMS_FROM=+17372583478
```

3. `SMS_DEV_APPROVAL_ORIGIN` must resolve to the application **using the same development database**, including its new migration. Local `http://localhost:3000` is fine for desktop-only click-through checks, but **cannot be opened on the phone** as localhost refers to the phone. Use a development-only HTTPS origin with proper access controls and test access.
4. Start `npm run dev`. Use a synthetic RO and verify the original Email and Verbal buttons remain functional.
5. Explicitly set `SMS_DEV_SEND_ENABLED=true` in the local development environment **only for an intended custom-message SMS test**, then restart dev.
6. In the RO panel, choose Text Estimate (Dev), replace the customer's number with your allowlisted personal verified number, confirm the consent checkbox, then send. Only the exact allowlisted number is permitted.
7. A restricted Twilio trial may reject the actual approval-link text. **Do not treat the predefined appointment reminder template as a passing end-to-end SMS test.**
8. If accepted, open the link on your phone, approve/decline the exact synthetic RO, and check View Authorization shows `SMS_LINK`.
9. Keep `SMS_DEV_SEND_ENABLED=false` whenever not actively testing. Do not copy any credentials or dev phone numbers into production.
10. Before production release: add webhook-verified delivery state, opt-out/consent enforcement, concurrency-safe rate limiting, provider registration and number provisioning, reviewed rollout, and full regression tests.

**Known limits:** Developer-only fixed recipient, accepted-by-provider status only (not delivery confirmed), and a per-shop cap of five accepted messages per 24 hours. These are deliberate development safeguards, not commercial behavior. The sender API is still provider-neutral, but this branch implements only the Twilio adapter.

## Current verification

Code committed to isolated branch. Twilio trial sample-template API delivery confirmed by developer. The integrated UI, dev migration, custom SMS content, browser journey, and TypeScript/build checks are not yet confirmed.
