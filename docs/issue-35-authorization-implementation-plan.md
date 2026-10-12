# Issue #35 — Customer Authorization & Evidence Implementation Plan

## Safety boundary
Development branch: `feature/issue-35-customer-authorization`.
All migrations and manual acceptance testing must run against `plumworks-dev` / `.env.development.local` before any production migration or deployment. Production is out of scope until explicit owner approval.

## Existing integration points confirmed
- Prisma/PostgreSQL data model in `prisma/schema.prisma` with shop-scoped entities.
- Repair-order detail UI in `src/app/(app)/repair-orders/[id]/page.tsx`.
- Existing repair-order server actions under `src/app/(app)/repair-orders/`.
- Existing RO email action/button can be extended for Phase 2 rather than creating a parallel email subsystem.
- Existing audit log remains supplemental; regulatory authorization evidence gets dedicated immutable records.

## Phase 1 — Evidence foundation + verbal authorization
1. Add enums for document type, authorization method/event/status.
2. Add immutable `DocumentRevision` containing shop/document identity, revision number, canonical JSON snapshot, SHA-256 digest, totals, and created timestamp.
3. Add append-only `AuthorizationEvent` tied to one revision. For verbal approval capture authorizer name, PHONE method, amount authorized, total discussed, notes, server timestamp, and staff user identity.
4. Build a server-only snapshot creator that canonicalizes the RO customer/vehicle identity, concerns, parts, labor, shop-supply/tax snapshots and estimated total. Reuse an existing identical current snapshot; otherwise create the next revision.
5. Add tenant-scoped actions to record verbal authorization and retrieve authorization history.
6. Add RO UI: authorization status, Record Verbal Authorization dialog, and Authorization History.
7. A current RO is authorized only when its current canonical snapshot/hash matches the latest applicable approval. A material edit therefore makes the current RO require authorization without mutating historical evidence.
8. No update/delete application actions for evidence records.

## Phase 2 — Remote digital approval
1. Add `AuthorizationRequest` tied to exactly one `DocumentRevision`.
2. Generate 256-bit random token; store SHA-256 token hash only. Add expiry, revocation, supersession and terminal decision timestamps.
3. Extend existing RO email workflow with Send for Approval.
4. Add public mobile approval page requiring explicit signer name + consent + Approve/Decline.
5. Store immutable consent text/version, server timestamp, IP/user-agent supporting metadata and an `AuthorizationEvent`.
6. Make POST idempotent and reject expired/revoked/superseded/decided requests.
7. Send confirmation and surface status/history in the RO.

## Phase 3 — Invoice delivery signature
1. Create immutable INVOICE `DocumentRevision` snapshots.
2. Add `SignatureEvidence` tied to an authorization event/revision, storing the signature artifact plus checksum and metadata.
3. Add touchscreen-first Capture Customer Signature flow with printed name, acknowledgement text/version, Clear/Cancel/Accept.
4. Keep customer delivery acknowledgement distinct from facility certification.
5. Add invoice Evidence viewer/history; no normal overwrite/delete path.

## Security and invariants
- Every private query/action is constrained by authenticated membership `shopId`.
- Public request tokens are high entropy, hashed at rest, scoped to one revision/action, expiring and revocable.
- Evidence uses server timestamps in UTC.
- Public pages reveal only data needed for the approval decision.
- Evidence records are append-only at the application layer.
- Cross-tenant IDs never authorize access.
- Material document changes never inherit approval because authorization is revision/hash scoped.

## Dev verification gates
### Gate 1
Run migration against `plumworks-dev`; automated tests; create RO; record verbal approval; inspect history; change price/work; verify Authorization Required; reauthorize; verify old evidence unchanged.

### Gate 2
Send dev approval email; approve/decline through public link; test expiry/revocation/replay and changed-RO supersession.

### Gate 3
Finalize dev invoice; capture signature at mobile/tablet viewport; retrieve evidence; regression-test invoice/payment/AR flows.

No production migration/deployment until all three gates pass and owner explicitly approves.