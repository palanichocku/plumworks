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
```

Twilio trial restrictions may prevent sending custom authorization text, even to verified test numbers. A paid and appropriately registered sender may be required before end-to-end live SMS can be tested.

## Foundation status

- [x] Provider-independent SMS sender interface.
- [x] Twilio adapter with API response handling and no sensitive response logging.
- [x] Explicit development-only real-send guard.
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
