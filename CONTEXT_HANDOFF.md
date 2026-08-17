PLUMWORKS / CAR DOC PROJECT HANDOFF

It is organized by date and update in Descending order. Read all of the file to get the complete context

=======================

Updated: August 17, 2026

ROLE

Act as a senior software engineer / technical reviewer helping me maintain and extend
PlumWorks.

I normally work through Codex in a terminal. I will often paste Codex results into the
chat and expect you to:

1. Review whether the implementation is correct and safe.
2. Identify any important blocker or regression.
3. Give me the next ready-to-paste Codex prompt.
4. Avoid unnecessary redesign when a working architecture already exists.
5. Protect data integrity above convenience.

Do not invent repository state, database state, test results, or customer requirements.

============================================================
PRODUCT
============================================================

PlumWorks is a horizontal small-business operations SaaS.

Auto repair is the first customer/testing vertical, but PlumWorks is NOT intended to be
automobile-repair-specific.

Future target businesses include:

- HVAC
- electrical service shops
- hardware/retail shops
- other small operations businesses

First real customer:

Car Doc LLC

Main application:

Next.js
TypeScript
Prisma
Supabase/PostgreSQL
Vercel

Main repo:

~/Projects/Web/plumworks

GitHub:
palanichocku/plumworks

Private client-specific deployment/content repo also exists:

~/Projects/Web/plumworks-deployments

============================================================
DEVELOPMENT WORKFLOW
============================================================

Until the customer approves the stable production baseline, iterative development has
mostly been done directly on main.

After the customer blesses the baseline, normal feature-branch development should be
preferred.

Data accuracy rule:

Historical legacy data should be corrected globally where safely possible.

Reports from January 1, 2026 forward must match the legacy Windows system exactly to the
penny.

Do not casually change reconciled financial/reporting logic.

============================================================
LEGACY WINDOWS SYSTEM
============================================================

Legacy application:

Shopman32

Primary source files:

orders.DBF / LABORorder.DBF
    open Repair Orders

FINAL.DBF / laborfinal.DBF
    finalized historical parts/labor

ar.DBF
    authoritative finalized financial totals

Important reporting semantics:

Windows sales reporting uses finalized/sold transactions and DATE_SOLD.

It does NOT report an RO merely because it was opened in that date period.

PlumWorks finalized-sale reporting now mirrors this.

Native PlumWorks Invoice:
    reportable only when status = closed
    reporting date = closedAt

Imported Windows Invoice:
    legacySourceTable != null
    reporting date = imported invoiceDate / Windows DATE_SOLD

Shared predicate:

reportableSaleWhere()

Do not modify this without explicit reconciliation work.

============================================================
HISTORICAL FINANCIAL CONTROLS
============================================================

These are locked reference controls and currently reconcile exactly.

January 2026:

Invoice count: 25
Parts: $7,028.91
Labor: $5,839.00
Subtotal: $12,867.91
Shop Supplies: $260.54
Tax: $480.16
Gross: $13,608.61

Q1 2026:

Invoice count: 83
Parts: $22,776.62
Labor: $23,616.00
Subtotal: $46,392.62
Shop Supplies: $824.86
Tax: $1,691.01
Gross: $48,908.49

H1 2026:

Invoice count: 195
Parts: $61,947.11
Labor: $61,781.00
Subtotal: $123,728.11
Shop Supplies: $2,078.43
Tax: $4,792.61
Gross: $130,599.15

Full year 2025:

Invoice count: 460
Parts: $133,400.21
Labor: $125,134.13
Subtotal: $258,534.34
Shop Supplies: $4,885.24
Tax: $9,873.03
Gross: $273,292.61

August 1–15, 2026:

Invoice count: 23
Parts: $8,603.53
Labor: $8,607.00
Subtotal: $17,210.53
Shop Supplies: $306.80
Tax: $678.87
Gross/Paid: $18,196.20
Balance: $0.00

Q3 through August 15:

66 invoices
Gross: $42,104.11

2026 YTD through August 15:

261 invoices
Gross: $172,703.26

============================================================
CURRENT PARALLEL BASELINE STATUS
============================================================

A successful August 15 parallel-baseline cutover was completed overnight August 16–17.

Final result:

PARALLEL BASELINE GO

Windows remains authoritative through August 31, 2026.

Starting August 17, customer enters real work into BOTH:

Windows Shopman32
and
PlumWorks

This is intentional dual-entry testing.

PlumWorks data entered during Aug. 17–31 is disposable.

On August 31:

1. Stop Windows transactions at an agreed cutoff.
2. Obtain a NEW shopman32.zip.
3. Create a new immutable snapshot.
4. Generate new recovery proposal and human approvals.
5. Review active Repair Orders.
6. Run full zero-write rehearsal.
7. Create fresh authoritative database backup.
8. Replace the parallel PlumWorks operational data.
9. Reconcile reports/data.
10. Declare PlumWorks live.

After the successful Aug. 31 final-production cutover:

Windows becomes read-only/reference.

No subsequent full Windows replacement is permitted.

============================================================
AUGUST 15 SOURCE
============================================================

Original ZIP:

~/Downloads/shopman32.zip

ZIP SHA-256:

b0acd0ab5882ff5892ebec88aac0b439715f6ed9ebc29fcde5854ee00b750443

Immutable snapshot:

~/Projects/Web/plumworks-backups/cardoc/parallel-baseline/2026-08-15/
2026-08-15-b0acd0ab5882

Snapshot manifest SHA:

36f5ac6f8d1894f4dab2d971ec6f65d878cc477542ec5e5a36581315815f69d7

Combined source fingerprint:

4bc7e9659855af3126375e5b333b224bb5ecb5b7c6e704aab5f238e886047743

============================================================
SUCCESSFUL AUGUST 15 IMPORT
============================================================

Production database after parallel baseline:

Customers:
3,666

Customer aliases:
6

Vehicles:
5,234

Archived recovered historical Vehicles:
20

Invoices:
11,711

AR rows:
11,711

Payments:
11,871

Payment total:
$4,247,192.43

nextRepairOrderNumber:
21765

Marketing Leads preserved:
7

Integrity result:

zero orphan Payments
zero orphan AR
zero alias or Customer relationship errors
zero invalid Vehicle/RO links
zero payment mismatches
zero deterministic conflicts
zero unexpected unresolved records
zero import errors

============================================================
CURRENT OPEN REPAIR ORDERS
============================================================

Exactly TWO operational open ROs were imported.

This independently matches what the customer said was open in Windows.

RO 21756

status:
open/native/editable

Customer legacy ID:
87607529

Vehicle legacy ID:
87612222

Date:
2026-08-13

Mileage:
164096

Parts:
0

Labor:
one line
1 hour
$134.00

Customer explicitly confirmed this is a real open RO and Aug. 13 is the correct date.

RO 21759

status:
open/native/editable

Customer:
87612084

Vehicle:
87612085

Date:
2026-08-15

Mileage:
122381

Parts:
3

Water pump:
$135

Thermostat housing:
$165

Coolant:
$52

Parts total:
$352

Labor:
2 substantive lines

Inspection/diagnosis:
1 hour
$0

Cooling-system repair:
1 hour
$585

Labor total:
$585

Fifteen blank structural Windows order rows were explicitly reviewed and excluded.

RO 11159

Must NOT appear operational/open.

It was proven stale duplicate residue:

20 old LABORorder rows
no active header
no active date
zero hours
zero amount

Finalized historical history already exists:

sold 2012-12-13
AR total $125.56

The stale rows were explicitly excluded while historical finalized history was retained.

============================================================
CUSTOMER RECOVERY
============================================================

Recovery Approval v4 is implemented.

August 15 decisions:

19 Customer decisions total.

6:
alias-existing-customer

11:
create-recovered-historical-customer

1:
create-historical-unknown-customer

Customer:
87605435

1:
keep-exact-zero-dollar-reference-unresolved

Customer reference:
87604740

RO:
18181

Reason:
exact authoritative total is $0.00 and no safe Customer identity exists.

Do not fabricate identity for this case.

============================================================
VEHICLE RECOVERY
============================================================

25 reviewed Vehicle candidates.

Final decisions:

20:
create-recovered-historical-vehicle

All created historical Vehicles are archived by default so they remain visible for
history but cannot accidentally be selected for new Repair Orders.

5:
link-existing-canonical-vehicle

Approved mappings:

87604082 -> 87604654
87604122 -> 87605596
87604419 -> 87604503
87604727 -> 87604699
87607116 -> 87608037

Historical Invoice.customerId remains the historical Customer.

Do not rewrite Invoice Customer ownership just because a Vehicle now belongs to another
current Customer.

All 56 affected historical Invoice/Vehicle relationships reconcile.

============================================================
BACKUP / ROLLBACK
============================================================

The backup/rollback framework is fully engineered and tested.

Authoritative cutover backup uses:

pg_dump
custom format
public schema
ACLs included
no ownership dependency

Backup is not considered authoritative until independently verified.

Reset cannot proceed without an opaque verified-backup gate.

Successful Aug. 15 pre-cutover backup:

~/Projects/Web/plumworks-backups/cardoc/parallel-baseline/2026-08-15/
destructive-cutover-backup/cutover-20260816-235234/
plumworks-public-cutover.dump

SHA-256:

0ad5499ba71c93dea4af4c7cef64c93623e59a4d5f646074371cc0cf7d8edec8

All 576 privilege controls passed.

This is the authoritative rollback backup for the Aug. 15 parallel baseline.

There is an earlier .incomplete dump from a failed attempt.

It MUST NOT be used as rollback authority.

============================================================
CUTOVER LIFECYCLE
============================================================

Three lifecycle behaviors now exist.

Legacy/default:

legacy_cutover_completed

Old behavior remains fail-closed for backward compatibility.

Parallel baseline:

--cutover-mode parallel-baseline

Requires:

--confirm RESET_SHOP_OPERATIONAL_DATA

and

--confirm-parallel-baseline REPLACE_PARALLEL_BASELINE_FROM_WINDOWS

and

--windows-authority-through YYYY-MM-DD

Successful event:

legacy_parallel_baseline_completed

This is NON-TERMINAL.

Final production:

--cutover-mode final-production

Requires:

--confirm RESET_SHOP_OPERATIONAL_DATA

and

--confirm-final-production FINALIZE_WINDOWS_PRODUCTION_CUTOVER

Successful terminal event:

legacy_final_production_cutover_completed

Once that event exists:

NO future Windows full replacement is permitted.

There is intentionally no override.

============================================================
RESET SAFETY
============================================================

Important FK issue was fixed.

CustomerLegacyAlias -> Customer is ON DELETE RESTRICT.

Therefore reset order explicitly deletes aliases before Customers.

InvoiceLegacyCharge -> Invoice is ON DELETE CASCADE.

Reset remains transactional.

Preserved data includes:

Shop
Shop memberships
Supabase Auth linkage
staff invites
Employees
Vendors
Canned services
settings
marketing content
Marketing Leads
Storage/non-operational configuration according to existing design

============================================================
RECENT IMPORTANT COMMITS
============================================================

Latest known successful sequence:

745d847982b4dabb92a26b0271aa0d855a013714
Add sales report period options

b1011e8baa5e5318a2ccbae39c3ed20aff390afc
Fix backup ACL privilege verification

8604d286925cca701295df1a48ef3bd4dd6d1335
Add parallel baseline cutover lifecycle

54d9622cbae4cc04bae91819a74faa7ff98492e9
Add reviewed active order cutover resolution

930c105c0706c3fdbde38498fdf60b157e3a7aca
Fix legacy cutover reset dependencies

Earlier major commit:

445b7c12fddfbe8f9953a929ec5ad35c3a5e65e2
Operationalize active orders at final cutover

After receiving this context, always ask me for current git status/HEAD if a proposed
change depends on repository state.

Do not assume these hashes remain current after future work.

============================================================
BACKUP ACL BUG ALREADY FIXED
============================================================

Production pg_dump emitted:

GRANT ALL ON TABLE public.accounts_receivable TO service_role;

The verifier originally understood individually named:

SELECT, INSERT, UPDATE, DELETE

but not GRANT ALL.

The parser was fixed generically to expand:

ALL
ALL PRIVILEGES

into tracked DML privileges.

Do NOT reintroduce table-specific logic.

============================================================
SALES REPORT PERIOD FEATURE
============================================================

Most recent feature:

Customer requested Windows-style report period selection.

Implemented:

Daily
Monthly
Quarterly
Yearly

All modes reuse:

getDailySalesReportModel()

and the same finalized-sale reporting query.

No accounting logic is duplicated.

Daily:

custom From / To date range

Monthly:

Month + Year

Quarterly:

Q1 / Q2 / Q3 / Q4 + Year

Yearly:

Year

All normalize to:

[start, endExclusive)

Screen, Print, and Email all preserve the same selected period.

Existing ?from=&to= URLs remain valid.

Historical years remain available.

Acceptance tests:

January 2026:
25 / $13,608.61

Q1 2026:
83 / $48,908.49

2025:
460 / $273,292.61

H1 custom range:
195 / $130,599.15

Latest commit:

745d847982b4dabb92a26b0271aa0d855a013714

This commit had not yet been pushed at the time of this handoff unless I tell you
otherwise.

============================================================
INVOICE / REPAIR ORDER BUSINESS RULES
============================================================

Invoices:

- shop supplies are explicitly shown
- shop supplies participate in tax calculation
- Invoice email works in production
- Payment entry defaults to unpaid balance
- Daily Sales includes native Invoices only once closed

Native close behavior requires:

- owner/admin authorization
- delivery confirmation
- balance exactly zero
- sets closedAt

Repair Orders:

Operational definition excludes read-only historical legacy ROs.

Historical imported legacy ROs remain accessible separately.

Current operational open ROs are native/editable.

Repair Order history is unified service history:

Invoice history + prior RepairOrder history

Deduplication is by authoritative Invoice.repairOrderId, not merely RO number.

Historical mileage:

AR.DBF ODOMETER is authoritative for finalized invoices.

orders.DBF ODOMETER is authoritative for active ROs.

============================================================
DASHBOARD
============================================================

Current intended top cards:

Open Repair Orders
Customers
Vehicles
Invoices This Month
New Leads

Open receivables / open AR summary were intentionally removed.

Lower panels:

Invoices in Progress
Closed Invoices

Open Repair Orders should show current operational ROs only.

After Aug. 15 baseline:

expected open count = 2.

============================================================
PARALLEL TESTING RULES AUG 17–31
============================================================

The customer will intentionally enter real work into BOTH systems.

Windows is authoritative.

During this period, help us compare:

Repair Orders
Invoices
parts
labor
shop supplies
tax
payments
customer/vehicle history
mileage
Daily/Monthly/Quarterly/Yearly reports

If PlumWorks differs from Windows:

do not modify Windows to match PlumWorks.

Treat the difference as a PlumWorks investigation unless source evidence proves Windows
data itself is wrong.

Do not perform another full Windows replacement during the parallel period casually.

A replacement requires the explicit parallel-baseline lifecycle and full safety gates.

============================================================
AUGUST 31 FINAL CUTOVER
============================================================

This will be a BRAND NEW cutover.

Do not reuse August 15 approvals merely because IDs look the same.

New ZIP means:

new ZIP hash
new immutable snapshot
new snapshot manifest
new Customer/Vehicle proposal
new Approval v4
new active-RO review
new snapshot-bound adjudications/resolutions
new zero-write rehearsal
new authoritative backup

Then:

--cutover-mode final-production

Upon successful final verification:

legacy_final_production_cutover_completed

must be written.

After that:

PlumWorks is authoritative.
Windows becomes read-only.
No further Windows replacement.

============================================================
HOW I WANT YOU TO HELP
============================================================

When I paste a Codex result:

- review it carefully
- tell me whether it is safe/correct
- point out any blocker
- give me the next focused Codex prompt
- avoid spending unnecessary Codex credits
- do not re-investigate already proven architecture unless new evidence requires it

For destructive/cutover work:

always prefer:

read-only investigation
→ zero-write rehearsal
→ authoritative verified backup
→ destructive operation
→ reconciliation
→ GO/NO-GO

Never casually bypass a safety gate.

If a safety gate blocks a valid business workflow:

fix the lifecycle/design explicitly rather than deleting audit evidence or weakening the
guard.

============================================================
CURRENT NEXT STEP
============================================================

The Aug. 15 parallel baseline is successfully installed.

Current immediate focus:

1. Push the current main branch if not already pushed.
2. Verify Vercel deployment.
3. Customer begins parallel testing.
4. Use the new Daily/Monthly/Quarterly/Yearly reports to compare historical Windows
   results.
5. Record discrepancies found during Aug. 17–31.
6. Prepare for the new Aug. 31 final-production cutover.

Do not treat the Aug. 15 baseline as the terminal live cutover.