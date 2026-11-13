# Batch 3 — Google Analytics 4 (GA4) setup for Car Doc

This feature is **DEV-only until separately reviewed for production**. The Google Business Profile and Search Console imports are independent and unchanged.

## 1. Create and isolate the development stream

In Google Analytics, create a GA4 property/web data stream dedicated to the **DEV public marketing website** at `https://dev.subbuscardoc.com`. Do not reuse the future production measurement ID: development browsing and test clicks would contaminate real customer traffic.

The web stream Measurement ID begins with `G-`. Configure `GA4_MEASUREMENT_ID` as a **server-side environment variable** in Vercel Preview scoped to the `dev` branch. Do not put the ID in source code. The website tag is enabled only for a correctly formatted measurement ID; it is attached to the `(marketing)` layout, not the authenticated shop application.

The Google tag runs with standard enhanced pageview collection. Do not add a second manual `page_view` tracker: duplicate tracking is misleading. If you change GA4 Enhanced Measurement settings, verify client-side navigation pages are counted exactly once.

## 2. Allow read-only visitor reporting

To show visitor figures in the application, configure these two **server-side** Vercel Preview variables for `dev`:

- `GA4_PROPERTY_ID` — the **numeric** GA4 property ID (not the G- Measurement ID).
- `GA4_SERVICE_ACCOUNT_JSON` — the complete credentials JSON for a dedicated Google Cloud service account. Keep it restricted to server-side configuration. Never commit this file, paste its private key into a chat, or expose it as NEXT_PUBLIC_*.

In Google Analytics property access management, grant that service account the **Viewer** role for the matching DEV GA4 property. It uses only the `analytics.readonly` scope and the GA4 Data API. Enable the Google Analytics Data API for the service account's Google Cloud project.

If no property or credentials are configured, the report displays **Not connected**. If a request fails or Google has no reportable rows, the report shows unavailable data rather than asserting zero visitors. Nothing is written to the application's reporting database.

## 3. Test in DEV

1. Verify DEV deployment is Ready, and check the public marketing pages on `dev.subbuscardoc.com`.
2. In GA4 Realtime or DebugView, verify visiting Home, Services, Contact, and Appointment appears only in the DEV property. Refresh or navigate: ensure one page-view event per real navigation.
3. Click the Call Now button. GA4's `call_button_click` event represents a tap, **not** an answered call. No phone number or lead form fields are sent by our code.
4. Open `/dashboard/website-performance`. The *Visitor behavior* panel shows the most recent **complete calendar month**, or an explicit unavailable state when Google has no data for it. New setups normally lack historical data.
5. Verify the shop application (`/dashboard`, Repair Orders, Invoices, etc.) does not load the GA4 tag.
6. Verify Google Search Console and Business Profile imports, charts, and existing marketing lead submission still work.

## 4. Production decision (later, after UAT)

Production needs **its own** correctly scoped GA4 Measurement ID, and its own approved GA4 property/service-account permissions. Visitor collection on the live public website starts **only when** its tracking tag is deployed and the production Measurement ID is configured. Previously untracked visits cannot be retroactively measured.

Do not promote or merge unrelated DEV changes directly into `main`; use the approved narrow production release strategy. Review the site's analytics privacy disclosure and legal requirements before enabling real-user tracking.

## Measurement definitions

- **Active visitors** (`activeUsers`): active website users, not unique new customers.
- **Visits** (`sessions`): sessions; a person can start multiple sessions.
- **Engaged visits** (`engagedSessions`): GA4 engaged sessions (typically longer than 10 seconds, a key event, or two or more page/screen views).
- **Pages viewed** (`screenPageViews`): pageviews, including repeats.
- **How visitors arrived**: `sessionDefaultChannelGroup` with session totals.
- **Most-viewed pages**: `pagePath` with page-view totals.

GA4 browsing metrics are **not** confirmed contact requests, accepted appointments, calls answered, or revenue. These business Outcomes are in Batch 4.
