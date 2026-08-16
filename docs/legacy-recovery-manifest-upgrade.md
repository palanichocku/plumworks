# Legacy Customer recovery manifest upgrade

> Historical compatibility only. Version 1 and version 2 manifests cannot authorize a final cutover. Final cutover uses the proposal and Recovery Approval v3 workflow below.

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

## Final-cutover proposal and Recovery Approval v3

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
  --output /protected/recovery/customer-recovery-approval-v3.json \
  --confirm APPROVE_CUSTOMER_RECOVERY_V3
```

Approval creation revalidates the immutable snapshot and exact proposal, requires complete explicit decisions and review metadata, writes atomically with mode `0600`, and refuses overwrite. It does not contact a database. Proposal, reviewed decisions, and approval must remain outside Git and `OriginalWinApp` in encrypted, access-controlled storage.

A new ZIP always requires a new snapshot, proposal, human review, and v3 approval. Changed ZIP, snapshot manifest, DBF, candidate, row key, deleted state, evidence hash, Vehicle evidence, AR reference, order set, Shop, proposal hash, or approval metadata fails closed.

### Vehicle evidence boundary

Historical Vehicle rows attached to exceptional Customers are recorded as hashed supporting identity evidence only. The accepted legacy behavior intentionally does not create recovered Vehicles. Historical Invoices remain linked to the recovered Customer, keep their imported vehicle snapshot and mileage, and may have a null `vehicleId`. They remain available in Customer history and Invoice history, but cannot become Vehicle-detail history without a real Vehicle row. Expanding this into Vehicle recovery requires a separate reviewed design and is not implied by Customer approval.
