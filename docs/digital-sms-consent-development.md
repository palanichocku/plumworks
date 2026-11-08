# Digital SMS consent — Development implementation contract

Source branch: `feature/dev-sms-estimate-authorization`. This branch is isolated from `main` and must not be merged before UAT and explicit production approval.

## In-shop flow

1. Staff opens an existing customer, verifies identity in person, and confirms the customer's mobile number.
2. Authorized staff chooses **SMS consent → Show QR**. Server creates a fresh 10-minute, single-use token bound to shop, customer, and normalized phone; the QR contains only a non-identifying token URL. A separate short PIN is displayed to the employee, who gives it to the verified customer. Cancel or expiry invalidates the session.
3. Customer scans on their own phone, enters the PIN, sees shop name and masked phone number, and an **unchecked** optional checkbox covering *only* service and estimate SMS notifications. Consent is independent from repair authorization and independent from agreeing to general terms.
4. On checked submission, server atomically validates token hash, expiry, unused status, PIN hash, exact customer/shop/phone binding, and current phone; it records a versioned opt-in event with disclosure text and timestamp and consumes the token. Unchecked submission consumes without opting in. Do not collect or log the QR token.
5. Staff sees a refreshed **Consented / Not consented / Opted out** state. A changed customer phone requires new opt-in for the new phone. No prior consent is imported from Windows.
6. Sending Text Estimate checks the authoritative latest event and number-level suppression immediately before invoking the existing provider; if either fails, fail closed. Keep the existing dev-only sender allowlist and disabled-production safeguard.
7. Twilio inbound webhook uses validated X-Twilio-Signature, handles STOP/HELP idempotently, and persists STOP suppression by destination number/shop even if the customer's matching record is ambiguous. Twilio's native carrier block is a separate additional protection. A QR opt-in must not automatically erase a carrier-level STOP block; use provider-approved re-subscription policy and explicit new permission.

## Public review evidence

Provide `/sms-consent/example` as a static, public, non-operational demonstration showing the exact unchecked checkbox and disclosures without exposing real customer data or allowing collection. Public Privacy Policy and SMS Terms must be published and legal-reviewed. The real consent route is non-indexed; use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, avoid third-party scripts and analytics. For Twilio supply a working demo URL or public screenshots/video of the complete real flow (including PIN step), plus URLs for privacy and terms.

## Disclosure v1 (review with shop before publication)

"I agree to receive text messages from [shop legal name] about my repair estimates and vehicle service updates at the mobile number shown above. Message frequency varies based on service activity. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is optional and is not a condition of purchasing services. See SMS Terms and Privacy Policy."

## Security and UAT gate

- Verify unauthorized staff cannot issue sessions, and cross-shop customer IDs cannot be used.
- Invalid/expired/reused PIN or token must fail without exposing customer details. Throttle guesses by IP and token, and require staff identity verification in person.
- Phone changed during pending session invalidates consent submission; captured event is linked to exact E.164 phone.
- Unchecked box never records opt-in. Forged form state without checkbox never grants consent.
- STOP blocks future texts even when another customer record shares the number; HELP does not opt-in.
- Consent must not authorize repairs; repair approve/decline and email/verbal evidence remain unchanged.
- Test with a fake SMS adapter. Do not send real customer SMS before campaign approval.
- Apply migration **only to dev project** `qchvjaqwanyimkidlqqu` after existing fingerprint checks. Do not migrate or deploy Production.
- Complete lint, typecheck, unit/integration tests, Dev UAT and owner acceptance before proposing a merge.

## Current status

Foundation migration only; routes, UI, send enforcement, STOP/HELP webhook, public documents, and testing are **not yet implemented**. Migration has not been applied to any database.
