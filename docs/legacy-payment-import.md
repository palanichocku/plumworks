# Legacy payment tender import

The standalone legacy Payment importer projects tender detail from one explicitly selected staged `ar.DBF` import run. It is not part of the consolidated legacy cutover.

## Financial authority

For each legacy order, `ar.DBF.TOTAL` is the authoritative Invoice total, `ar.DBF.PAYMENT` is the authoritative cumulative paid total, and `ar.DBF.BALANCE` is the authoritative remaining balance. The importer requires:

```text
sum(supported nonzero tender buckets) = PAYMENT
TOTAL - PAYMENT = BALANCE
Invoice.total = TOTAL
Invoice.paidTotal = PAYMENT
```

Payment rows supplement those stored totals with tender-method detail. They do not recalculate or replace `Invoice.paidTotal`, Accounts Receivable balance, or any Invoice total. Partial cumulative payments are supported when their tender sum equals `PAYMENT` and the remaining balance reconciles.

The legacy source proves tender bucket but not payer identity. Imported Payment rows therefore use `payerType = OTHER`; no Customer, insurer, or warranty attribution is fabricated. The additive payer/note schema remains in place across a refresh because cutover deletes and reloads operational rows without rolling back Prisma migrations.

Supported source buckets are `CASH`, `CHECK`, `AMEX`, `DISCOVER`, `MAST_VISA`, `ACCC`, and `ACCOUNT`. Each nonzero bucket receives a deterministic identity based on shop, legacy repair-order number, and source bucket. The source bucket remains in the Payment reference so the three card buckets remain distinguishable after normalization to `card`.

## Date limitation

The only approved policy is `invoice-date-proxy`. It assigns `Payment.paidAt` from the transformed Invoice date because an exact receipt timestamp is not available in the accepted legacy source. Importer period summaries are therefore labeled **Legacy payment tender allocation using Invoice date proxy** and must not be represented as actual payment receipt-date reporting.

## Safety and usage

The importer requires the exact staged run UUID and never chooses the latest run:

```sh
npm run legacy:payments:import -- \
  --import-run-id 00000000-0000-4000-8000-000000000000 \
  --payment-date-policy invoice-date-proxy \
  --dry-run
```

Use `--shop-id` when the database contains multiple shops. A confirmed import additionally requires `--confirm IMPORT_LEGACY_PAYMENTS`. Dry run is the default, and all source, Invoice, Customer, unsupported-field, duplicate, and deterministic-identity checks complete before a transaction can begin.

`DEPOSIT`, difference/credit fields, bad-debt indicators, and other unsupported transaction-history details are classified and reported. Nonzero ambiguous financial values prevent writing; this importer does not invent refund, reversal, void, deposit, credit, or adjustment transactions. `DISCOUNT` and `DEDUCT` remain handled by the existing Invoice financial transformation and do not create Payment rows.

An identical existing deterministic Payment is accepted as unchanged. A materially different row with the same identity is a conflict. Corrected legacy values are expected to be loaded through the full-replacement process, where the shop's prior Payment rows are removed before this standalone importer is run at its approved future cutover position.

The approved recovered-source aggregate baseline is encoded only as non-sensitive counts and totals. Reproducing it depends on the private approved recovery manifest, which is intentionally not checked into Git. Pure projection tests use synthetic, non-customer data; source aggregate verification must be run separately with that approved manifest.
