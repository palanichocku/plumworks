# Legacy Customer recovery manifest upgrade

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
