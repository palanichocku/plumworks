# Legacy Customer recovery manifest upgrade

> Historical compatibility only. Version 1, version 2, and Customer-only Approval v3 artifacts cannot authorize a strengthened final cutover. Final cutover uses the Customer-and-Vehicle proposal and Recovery Approval v4 workflow below.

Use the filesystem-only upgrader to bind an already approved version 1 Car Doc recovery manifest to one accepted immutable snapshot. The command does not connect to Prisma, rerun Customer matching, change decisions, or grant cutover authority.

Dry run:

```sh
npm run legacy:recovery:upgrade -- \
  --input <v1-manifest> \
  --snapshot-manifest <snapshot-manifest> \
  --shop-id <shop-uuid> \
  --output <v2-manifest> \
  --dry-run
```

Confirmed atomic file creation:

```sh
npm run legacy:recovery:upgrade -- \
  --input <v1-manifest> \
  --snapshot-manifest <snapshot-manifest> \
  --shop-id <shop-uuid> \
  --output <v2-manifest> \
  --confirm WRITE_RECOVERY_MANIFEST_V2
```

The original manifest is never overwritten. The output preserves every alias, recovered Customer, unresolved disposition, review status, and evidence field and adds only version 2 snapshot/shop binding, calculated counts, timestamp, and input-manifest SHA-256 provenance.

The upgrader verifies the snapshot manifest and extracted file identities, reconstructs source references without database access, and passes the proposal through the same version 2 binding and recovery planner used by `legacy:rehearse`. Stale evidence, collisions, unexpected unresolved references, malformed source files, or an existing output path block generation. Each new snapshot must be validated independently and may require a newly reviewed recovery manifest; the upgrader never changes decisions to fit a new snapshot.

## Final-cutover proposal and Recovery Approval v4

After immutable snapshot intake, generate a non-authorizing proposal:

```sh
npm run legacy:recovery:propose -- \
  --snapshot-manifest /protected/snapshot/manifest.json \
  --shop-id <shop-uuid> \
  --output /protected/recovery/customer-recovery-proposal.json
```

The proposal is generated only from validated snapshot files. It records the Shop, ZIP hash, snapshot-manifest hash, combined source fingerprint, relevant DBF hashes, deterministic candidate IDs, stable row keys, row-evidence hashes, exact RO sets, AR authority, and supporting Vehicle evidence. It contains no approval and cannot unlock rehearsal, backup, or reset.

Review every candidate against the immutable snapshot. Store explicit reviewed decisions in a separate private `legacy-customer-recovery-reviewed-decisions` artifact. Suggestions in the proposal are not copied into approval automatically. Every candidate needs exactly one reviewed decision; unresolved records are limited to the existing exact zero-dollar `keep-skipped` policy.

Create the approved artifact only after review:

```sh
npm run legacy:recovery:approve -- \
  --proposal /protected/recovery/customer-recovery-proposal.json \
  --snapshot-manifest /protected/snapshot/manifest.json \
  --reviewed-decisions /protected/recovery/reviewed-decisions.json \
  --reviewed-by '<reviewer>' \
  --reviewed-at '<ISO-8601 timestamp>' \
  --reason '<review record>' \
  --output /protected/recovery/customer-recovery-approval-v4.json \
  --confirm APPROVE_CUSTOMER_RECOVERY_V4
```

The proposal contains separate Customer and Vehicle candidate sets. Vehicle classifications (`safe-create-candidate`, `exact-vin-canonical-candidate`, and `ambiguous-vehicle-candidate`) are evidence, not authorization. Reviewers must explicitly choose `create-recovered-historical-vehicle`, `link-existing-canonical-vehicle`, or `remain-evidence-only` for every Vehicle. Exact VIN agreement is never auto-approved. Evidence-only requires a reason and intentionally leaves the affected historical Invoices without a Vehicle relationship.

Recovered historical Vehicles are archived by default, retaining history while keeping them unavailable for new Repair Orders. An existing canonical Vehicle link does not rewrite the historical Invoice Customer. Approval creation revalidates the immutable snapshot and exact proposal, requires complete explicit Customer and Vehicle decisions and review metadata, writes atomically with mode `0600`, and refuses overwrite. It does not contact a database. Proposal, reviewed decisions, and approval must remain outside Git and `OriginalWinApp` in encrypted, access-controlled storage.

A new ZIP always requires a new snapshot, proposal, human Customer review, human Vehicle review, and v4 approval. Changed ZIP, snapshot manifest, DBF, candidate, row key, deleted state, evidence hash, VIN/plate/YMM/ownership/collision evidence, canonical target, AR reference, order set, Shop, proposal hash, or approval metadata fails closed.

### Vehicle evidence boundary

Historical Vehicle rows attached to exceptional Customers are proposed as PII-minimized, hashed evidence. Approval v4 must explicitly resolve each candidate. Created recovered Vehicles use deterministic IDs and default to archived; canonical links require exact reviewed target and ownership evidence; evidence-only decisions retain a null `vehicleId` by explicit review. The approved mapping is applied only to the exact listed historical Invoices. Customer identity, mileage, dates, and all financial values remain unchanged.
