# End-to-end legacy refresh rehearsal

`legacy:rehearse` is a dry-run-only orchestration command. It accepts either the read-only repository seed or a customer-supplied ZIP, creates an immutable snapshot, reconstructs and validates the exact Customer recovery proposal and approved Recovery Approval v3, captures shop-scoped counts, runs the consolidated cutover dry run, validates its ordered stage ledger and reconciliation results, captures the same counts again, and runs the focused legacy checks.

Version 1 and version 2 recovery files are historical compatibility artifacts and cannot authorize final-cutover rehearsal. Generate a proposal and explicit Recovery Approval v3 using `docs/legacy-recovery-manifest-upgrade.md`.

It has no confirmed mode and rejects every confirmation argument or phrase. It does not pass `OriginalWinApp` as an import source, apply migrations, run reset/backup/import stages, or alter database rows.

Seed rehearsal:

```sh
npm run legacy:rehearse -- \
  --seed \
  --snapshot-date YYYY-MM-DD \
  --customer-recovery-proposal /protected/path/recovery-proposal.json \
  --customer-recovery-manifest /protected/path/recovery-approval-v3.json \
  --workspace /protected/rehearsal-directory
```

Customer ZIP rehearsal:

```sh
npm run legacy:rehearse -- \
  --zip /path/to/shopman32.zip \
  --snapshot-date 2026-07-31 \
  --customer-recovery-proposal /protected/path/2026-07-31-recovery-proposal.json \
  --customer-recovery-manifest /protected/path/2026-07-31-recovery-approval-v3.json \
  --final-cutover-adjudication /protected/path/2026-07-31-active-ro-adjudication.json \
  --workspace /protected/rehearsal-directory
```

The command creates a private `rehearsal-*` directory containing `incoming`, `snapshots`, `manifests`, `reports`, and `logs`. The temporary seed ZIP is always removed. A customer ZIP is never removed or modified. By default, the rehearsal snapshot is removed after the reports are written; pass `--keep-snapshot` to retain it.

`--final-cutover-adjudication` is optional and is only appropriate after explicit human review of an exceptional active-RO source artifact. The rehearsal supplies its newly created immutable snapshot manifest to the cutover validator automatically. The adjudication must match that exact ZIP, snapshot manifest, source fingerprint, DBF hashes, source rows, and finalized collision; otherwise rehearsal stops. A new ZIP always requires revalidation, and an artifact that disappears receives no carried-forward exclusion.

The JSON and Markdown reports are sanitized aggregate reports. They record Git state, ZIP identity, source fingerprint, proposal and Recovery Approval v3 fingerprints, ordered stage validation, Customer/Vehicle, Invoice/AR, Payment and open-order aggregates, before/after database counts, tests, lint, warnings, and any failed stage. Invoice-date payment groupings remain explicitly labeled as proxy allocations rather than receipt chronology.

The rehearsal also proves the current fresh-transform contract:

- `ar.DBF.ODOMETER` is normalized into `Invoice.odometer`; `orders.DBF.ODOMETER` is normalized into `RepairOrder.odometer`. Positive integers, comma grouping, and deterministic `K` shorthand are accepted. Blank, zero, negative, malformed, or over-limit values remain null. Current `Vehicle.odometer` is never historical service mileage and is never a fallback.
- `FINAL.DBF.SOURCE` becomes `InvoicePart.vendorNameSnapshot`, and `orders.DBF.SOURCE` becomes `RepairOrderPart.vendorNameSnapshot`, using exact deterministic legacy line keys. Codes are preserved verbatim because no reliable immutable lookup proves an expanded Vendor name. Blank values remain null and display as “Not recorded.”
- Imported `laborfinal.DBF` and `LABORorder.DBF` rows are ordinary, non-complimentary labor. Zero hours, rate, or amount never imply complimentary service.
- Generic imported open orders remain historical/direct-detail records. In explicit final-cutover projection mode, conclusively active cutoff orders become operational with `legacySourceTable: null`, the original Windows number in `legacyRoNo` and `repairOrderNumber`, and status `open`. Dashboard, active Repair Orders, editing, and Invoice creation use the shared operational predicate. Acceptance blocks invalid dates, identity ambiguity, number collisions, and finalized-Invoice collisions before any reset.
- Unified history remains shop/customer/vehicle scoped, combines Invoice and Repair Order sources, deduplicates through `Invoice.repairOrderId`, and preserves its existing ordering and cursor pagination.
- The Invoice-odometer and Invoice-part Vendor recovery planners run against the fresh projection and must each propose zero updates with zero conflicts, unresolved matches, or ambiguity. Their confirmed scripts are emergency diagnostics, not normal cutover stages.

Before the dry-run cutover projection, the rehearsal verifies every migration directory and `migration.sql`, the current Prisma fields, and the target `_prisma_migrations` history. It runs `prisma validate` and `prisma generate` but never applies a migration. If migrations are pending, rehearsal blocks and reports that `prisma migrate deploy` is required before the confirmed cutover.

The operational command order is:

1. Run the zero-write rehearsal command above and review both reports.
2. Deploy all required migrations separately with the documented production migration workflow, if and only if rehearsal reports they are pending; rerun rehearsal afterward.
3. Run the cutover dry-run command documented in `docs/cutover-runbook.md`.
4. After backup confirmation, downtime, and explicit approval, run the single confirmed backup/reset/reload cutover command from that runbook.
5. Run the post-cutover verify command. Do not run either recovery backfill unless verification exposes a concrete historical defect.

## Customer and Vehicle lifecycle compatibility

Fresh legacy transforms do not infer archive state. Imported Customers and Vehicles are created active (`archivedAt = null`) because no authoritative legacy archive field has been established; age, missing contact data, notes, or lack of recent work are not archive evidence. The nullable archive columns therefore do not change identity matching, recovery-manifest decisions, service history, or financial reconciliation.

Before the accepted final cutoff, a rehearsal is repeatable and Windows remains authoritative. After the confirmed final cutover succeeds and staff begins changing operationalized cutoff orders in PlumWorks, the Windows snapshot must not be used for another full replacement: that process is intentionally one-way and is not a merge. Archive/delete decisions are not part of recovery manifest v2.
