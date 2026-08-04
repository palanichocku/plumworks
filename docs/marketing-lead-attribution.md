# Marketing lead attribution

Public Contact, Appointment, and Drop-Off submissions store normalized first-touch website attribution on `MarketingLead`. The existing `source` enum remains the form type. Call Now tracking remains a separate recognizable call-click lead under the current product behavior and must not be treated as a submitted form conversion in reporting.

Attribution is captured in a versioned, HTTP-only, same-site session cookie on the first public marketing request. Internal navigation does not replace it. Malformed, unversioned, or unsupported-version cookies are replaced safely. URL query strings and fragments are not stored in referrer or page-path fields.

Future reporting can group tenant-scoped leads by:

- `attributionSource` for leads by source or direct traffic
- `attributionCampaign` for leads by campaign
- existing `source` for leads by form type
- `shopId`, attribution fields, and `createdAt` for time-bounded shop reports

These fields establish lead attribution only. They do not associate leads with invoices, payments, or revenue.
New direct visits are stored explicitly as `direct`; pre-attribution rows with null attribution remain `unknown` and should not be reclassified as direct traffic.
