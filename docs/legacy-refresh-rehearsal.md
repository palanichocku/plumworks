# End-to-end legacy refresh rehearsal

`legacy:rehearse` is a dry-run-only orchestration command. It accepts either the read-only repository seed or a customer-supplied ZIP, creates an immutable snapshot, validates the explicitly supplied snapshot-bound Customer recovery manifest, captures shop-scoped counts, runs the consolidated cutover dry run, validates its ordered stage ledger and reconciliation results, captures the same counts again, and runs the focused legacy checks.

An approved version 1 recovery file must first be converted with the documented filesystem-only workflow in `docs/legacy-recovery-manifest-upgrade.md`.

It has no confirmed mode and rejects every confirmation argument or phrase. It does not pass `OriginalWinApp` as an import source, apply migrations, run reset/backup/import stages, or alter database rows.

Seed rehearsal:

```sh
npm run legacy:rehearse -- \
  --seed \
  --snapshot-date YYYY-MM-DD \
  --customer-recovery-manifest /protected/path/seed-recovery-v2.json \
  --workspace /protected/rehearsal-directory
```

Customer ZIP rehearsal:

```sh
npm run legacy:rehearse -- \
  --zip /path/to/shopman32.zip \
  --snapshot-date 2026-07-31 \
  --customer-recovery-manifest /protected/path/2026-07-31-recovery-v2.json \
  --workspace /protected/rehearsal-directory
```

The command creates a private `rehearsal-*` directory containing `incoming`, `snapshots`, `manifests`, `reports`, and `logs`. The temporary seed ZIP is always removed. A customer ZIP is never removed or modified. By default, the rehearsal snapshot is removed after the reports are written; pass `--keep-snapshot` to retain it.

The JSON and Markdown reports are sanitized aggregate reports. They record Git state, ZIP identity, source fingerprint, recovery binding, ordered stage validation, Customer/Vehicle, Invoice/AR, Payment and open-order aggregates, before/after database counts, tests, lint, warnings, and any failed stage. Invoice-date payment groupings remain explicitly labeled as proxy allocations rather than receipt chronology.
