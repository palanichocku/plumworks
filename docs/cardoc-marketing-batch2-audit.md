# Car Doc website growth batch — audit and release notes (Nov 12, 2026)

## Existing functionality (preserved)
- Homepage and service pages already link to Request Service and tracked tap-to-call.
- Contact / appointment / drop-off requests already create leads and notify configured shop contacts; this batch does not change those handlers or consent/anti-spam flows.
- Service detail pages already include local headings, metadata, Service/Breadcrumb structured data, related-service internal links and service-specific request CTAs.
- Genuine review quotes render only when explicitly published in authorized marketing content; otherwise Google and Facebook profile links are available.
- Warranty page and badges are already in production; no warranty changes in this batch.

## Focused development improvement (#147)
- A concise trust section immediately after the homepage hero surfaces **existing** owner role (when provided), shop address and customer-authorization process without adding unsupported new claims.
- A small-screen fixed bar offers existing tracked Call and attributed Request Service links; it only renders if the shop phone number is configured. Existing desktop links and lead routes remain unchanged.
- Avoid claims for ratings, review totals, prices, same-day service and vehicle makes unless verified from owner-approved data.
- No database migration, operational application change, or lead form rewrite.

## Review project (#20) — awaiting publishable source
- Google/Facebook source links remain; no copied review text, arbitrary star counts or self-serving review JSON-LD.
- Customer-provided testimonial with display permission, or an API-based authorized live reviews integration, is required before showing new verbatim quotes.
- Owner's direct Google review link still needed if prompting new reviews.

## Local search audit (#149 / #150)
- Car Doc website currently lists: 42464 Mound Rd, Sterling Heights MI 48314; (586) 843-3347; Mon–Fri 9 AM–6 PM, Sat 9 AM–3 PM, Sun closed.
- Birdeye's publicly indexed Car Doc listing lists: Mon closed; Tue–Sat 9:30 AM–6:30 PM; Sun 10:30 AM–4:30 PM (captured Nov 12, 2026). This conflicts with the website and must be resolved with the shop owner before any directory edit.
- Storefront/service pages already have substantial category-level local copy. Do not create near-duplicate thin city pages or unsupported make-specific claims.
- Follow-ups: confirm authoritative hours, directory ownership/access, Google Business Profile category and address, Search Console query baseline.

## Dev UAT and release gate
1. Homepage renders trust strip with existing owner role and address; no invented ratings or offers.
2. At mobile width, sticky Call and Request Service buttons are tappable and don't obscure the page footer; desktop shows existing layout.
3. Call-click remains a click event (not counted as a connected call); Request Service retains attribution and request-not-booking wording.
4. Existing contact, appointment and drop-off lead capture and alerts remain unaffected (no live prod lead submissions from dev).
5. Public navigation check: for every new route ensure both proxy marketing allowlist and matcher include the route. No new route in this batch.
6. Verify published homepage, /reviews, /services and at least two service details in dev. Check 404, HTTPS redirects, canonical and mobile.
7. Before production: approval after visual UAT; then selective website-only port from main, verify production-domain redirects and smoke-check app login.

## Metrics pending authoritative access
14–28 day baseline: actual qualified leads, completed request conversions, tracked call clicks (not real calls), response rate, downstream ROs. No metric estimates have been fabricated.
