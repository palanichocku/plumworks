# Car Doc — Development Twilio SMS go-live preparation

**Scope:** only the PlumWorks Development environment at `https://dev.subbuscardoc.com`. Production SMS sending remains disabled. This runbook is not authorization to send messages.

## A2P readiness

Car Doc's US long-code number is `+15869325090` and its A2P Customer Care campaign was **In Review** as of November 8, 2026. Do not attempt customer or test SMS traffic on this number until Twilio confirms campaign approval and associates it with the approved Messaging Service and sender pool. The Twilio account is Car Doc-owned.

## Required Development-only environment settings

Configure **server-side** variables only in the intended Vercel Preview `dev` branch environment (and the isolated local Development environment as needed):

- `TWILIO_ACCOUNT_SID` — Car Doc account SID. Never commit it.
- `TWILIO_AUTH_TOKEN` — private account token for verifying Twilio webhook signatures. Never log it.
- `TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET` — recommended restricted API key pair for outbound messaging. If absent, the adapter uses the account SID and Auth Token for outbound API authentication.
- `TWILIO_MESSAGING_SERVICE_SID` — the Car Doc registered Messaging Service SID (recommended). Confirm its sender pool contains only the intended Development test sender while conducting testing.
- `TWILIO_SMS_FROM=+15869325090` — the expected Car Doc sender.
- `SMS_DEV_ALLOWED_TO=+1XXXXXXXXXX` — exactly one approved, controlled test handset, E.164 format.
- `SMS_DEV_APPROVAL_ORIGIN=https://dev.subbuscardoc.com`
- `SMS_TWILIO_WEBHOOK_URL=https://dev.subbuscardoc.com/api/sms/inbound`
- `SMS_TWILIO_STATUS_URL=https://dev.subbuscardoc.com/api/sms/status`
- `NEXT_PUBLIC_SMS_DEV_UI_ENABLED=true` — Dev-only UI enablement.
- `SMS_DEV_SEND_ENABLED=false` — keep **false until campaign approval**, sender verification and an approved live test. Set to `true` for controlled Development UAT only.

All settings must be restricted to the Development environment, not shared with Vercel Production. The code also enforces `VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=dev` (or a local Development runtime) before an outbound request can proceed. A test-number allowlist, stored customer-number consent, Repair Order readiness, and five-per-shop/24-hour counter provide additional gates.

## Database sender mapping (Development only)

After confirming the correct shop ID through a read-only query in `plumworks-dev`, insert exactly one sender-to-shop mapping in `sms_sender_numbers`. The canonical sender number is `+15869325090`. Confirm the mapping against the Development shop name and ID; never guess or use Production Supabase credentials. Confirm no other shop owns that number. The inbound webhook rejects unmapped senders.

Do not grant `anon` or `authenticated` access to the SMS tables.

## Twilio Console (only when ready for Development UAT)

1. Confirm **A2P Campaign = Approved** and the sender number is assigned to that campaign's Messaging Service.
2. Check the Messaging Service inbound webhook: **HTTP POST** `https://dev.subbuscardoc.com/api/sms/inbound`. Twilio signs this webhook with its account Auth Token.
3. Review the Messaging Service default STOP/HELP replies and Advanced Opt-Out settings. The application returns **empty TwiML**, relying on provider-managed automatic replies. Confirm the expected behavior on an actual test handset before launch.
4. Send callbacks use a **per-message** `StatusCallback` URL generated from `https://dev.subbuscardoc.com/api/sms/status`, including the internal request ID. No separate Twilio Console status URL is necessary.
5. Avoid enabling Production SMS or configuring the Production domain here. A single Twilio sender/Messaging Service may need its inbound webhook switched at actual cutover; plan this explicitly to avoid losing opt-out callbacks.

## Development UAT after approval

- Consent using shop iPad; consent using customer's phone QR + PIN; decline; invalid/expired session; changed number.
- No-consent, declined, and STOP-suppressed recipients must all be blocked before Twilio.
- Save a test Repair Order, confirm one allowlisted test number and recorded consent, then send one authorization SMS.
- Verify provider acceptance separately from delivery. Twilio must POST a signed status callback updating `authorization_requests.sms_delivery_status` to `delivered`, `failed`, or `undelivered`.
- Tap the unique link on the test phone; approve and decline different fresh RO revisions; verify `SMS_LINK` authorization evidence and existing email/verbal approval behavior.
- Reply HELP; confirm expected provider response and inbound log. Reply STOP; verify number suppression and that a subsequent attempt cannot send.
- Send START only as an explicit re-enrollment experiment; it must not silently clear PlumWorks suppression. Define a verified, customer-facing re-enrollment workflow before commercial rollout.
- Test forged webhook signatures, wrong Twilio AccountSid, mismatched MessageSid, duplicated and out-of-order status callbacks, unknown sender, repeated requests, provider failure, and five-per-shop/24-hour limit.
- Leave `SMS_DEV_SEND_ENABLED=false` when UAT finishes.

## Production promotion gates

No change to Production should be made as part of this Development preparation. Once Development UAT is approved, a **separate Production hardening** is necessary: remove Dev-only gates through explicit tenant-scoped sender configuration, enforce opt-in and suppression in Production, provision and verify Production webhook URL(s), configure Car Doc production secrets and sender mapping, apply reviewed Production migrations after backup, perform controlled smoke tests, and explicitly authorize first real customer SMS. Do not merge a branch containing test-sending toggles into a production-enabled configuration.
