# Car Doc Batch 3 — Local SEO and business listing audit
Date: 2026-11-13. Dev-only website change. Public sources, not Google Business Profile owner access.

## Current website facts (verify with owner before changing)
- Business name shown on site: CAR DOC LLC / Car Doc branding
- Address: 42464 Mound Road, Sterling Heights, MI 48314
- Phone: (586) 843-3347
- Hours: Mon–Fri 9:00 AM–6:00 PM; Saturday 9:00 AM–3:00 PM; Sunday closed
- Homepage, ten detailed service pages, Contact, About, Reviews, Warranty and appointment request already exist.
- Structured AutoRepair, Service and Breadcrumb metadata, canonical links and sitemap already exist; avoid duplicate doorway/city pages.
- No changes to business hours or claims in this release.

## Listings findings / unresolved discrepancies
- Sterling Heights municipal business list confirms Car Doc, 42464 Mound Rd and (586) 843-3347. Source: https://www.sterlingheights.gov/DocumentCenter/View/13195/BL---Sterling-Heights-Current-List-of-Businesses
- Birdeye currently lists 42464 Mound Rd but **Mon closed, Tue–Sat 9:30–6:30, Sun 10:30–4:30**, conflicting with the site. Source: https://reviews.birdeye.com/car-doc-149411519209432
- Other public directories disagree on Car Doc review counts/ratings and may be stale. Do not edit website's numeric 4.6 Google rating without verifying against primary Google listing.
- No owner-authorized Google Business Profile session or edits were available. Do not claim Google, Bing, Apple or Birdeye information is corrected.

## Safe changes in this dev PR (#149)
- Show shop address, hours and 'Get Directions' in the request sidebar on **all structured and legacy service-detail pages**. Data comes from the same shop record and hours source as the footer; no hard-coded Car Doc identity, offer, phone or business hours.
- Existing appointment links preserve service parameter; tracked call links remain unchanged.
- No new public URLs; sitemap, proxy, SEO metadata, service content, booking flows and app remain unchanged.

## GBP and directory checklist (#150; owner input needed)
1. Owner confirms authoritative business name, hours (including holidays) and whether the shop is open on Sunday.
2. Authorized GBP manager checks primary category, service list, website URL, appointment URL, phone, address/pin, storefront photos and business description.
3. Request correction of Birdeye hours; subsequently check Apple Maps, Bing Places and other high-traffic directories.
4. Capture initial Google Business Profile performance/Google Search Console query baseline and compare after publication; measure *qualified leads*, not just clicks.
5. Refresh Google rating displayed on website only when its value is checked against the shop's own Google listing.

## Release gate
- Review the new shop visit card in dev for **/services/brakes**, **/services/diagnostics**, and a legacy fallback service if present.
- Check service-linked request forms, phone tracking, directions and responsive layout.
- Confirm /reviews and /warranty remain public, /dashboard still app-only, and login still responds.
- Owner approves dev before website-only selective promotion to main. Do not merge the full dev branch.
