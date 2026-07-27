import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { aliasResolutionMaps, resolveLegacyCustomerId } from "./lib/legacy-customer-recovery.mjs";
import { centsToDecimal } from "./lib/legacy-invoice-financials.mjs";
import {
  executeLegacyPaymentInsertTransaction,
  LEGACY_PAYMENT_DATE_LABEL,
  LEGACY_PAYMENT_PERSISTED_FIELDS,
  LEGACY_TENDER_BUCKETS,
  parseLegacyPaymentImportArguments,
  projectLegacyPayments,
} from "./lib/legacy-payment-import.mjs";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

const options = parseLegacyPaymentImportArguments(process.argv.slice(2));
console.log(`Execution mode: ${options.dryRun ? "DRY RUN" : "CONFIRMED WRITE"}`);
console.log(`Confirmation status: ${options.confirmationStatus}`);
console.log(`Database writes permitted: ${options.confirmedWrite ? "yes" : "no"}`);
console.log(`Import run: ${options.importRunId}`);
console.log(`Payment date policy: ${LEGACY_PAYMENT_DATE_LABEL}`);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

function printAggregate(label, aggregate) {
  console.log(`${label}: ${aggregate.count} / ${centsToDecimal(aggregate.amountCents)}`);
}

try {
  // Passing null deliberately prevents an environment variable from silently selecting a shop.
  const shopId = await resolveSingleShopId(prisma, options.shopId ?? null);
  const [shop, importRun] = await Promise.all([
    prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { id: true, name: true } }),
    prisma.legacyImportRun.findFirst({
      where: { id: options.importRunId, shopId },
      select: { id: true },
    }),
  ]);
  if (!importRun) throw new Error("The requested import run does not exist in the selected shop.");

  const [sourceRows, invoices, customers, aliases] = await Promise.all([
    prisma.rawLegacyAr.findMany({
      where: { shopId, legacyImportRunId: options.importRunId },
      select: { id: true, shopId: true, legacyImportRunId: true, legacyRoNo: true, legacyCustno: true, rawData: true },
      orderBy: { id: "asc" },
    }),
    prisma.invoice.findMany({
      where: { shopId, legacyRoNo: { not: null } },
      select: { id: true, legacyRoNo: true, customerId: true, invoiceDate: true, paidTotal: true, total: true },
    }),
    prisma.customer.findMany({
      where: { shopId, legacyCustno: { not: null } },
      select: { id: true, legacyCustno: true },
    }),
    prisma.customerLegacyAlias.findMany({
      where: { shopId },
      select: { customerId: true, aliasLegacyCustno: true },
    }),
  ]);
  if (sourceRows.length === 0) throw new Error("The requested import run has no RawLegacyAr rows for the selected shop.");

  const { exactCustomerIds, aliasCustomerIds } = aliasResolutionMaps(customers, aliases);
  const resolvedCustomers = [...new Set(sourceRows.map((row) => row.legacyCustno?.trim()).filter(Boolean))].map((legacyCustno) => ({
    legacyCustno,
    customerId: resolveLegacyCustomerId(legacyCustno, exactCustomerIds, aliasCustomerIds),
  })).filter((resolution) => resolution.customerId);

  const projectionInputs = {
    shopId,
    importRunId: options.importRunId,
    stagedArRows: sourceRows,
    invoices,
    resolvedCustomers,
    paymentDatePolicy: options.paymentDatePolicy,
  };
  const initialProjection = projectLegacyPayments(projectionInputs);
  const existingRows = initialProjection.proposedRows.length === 0 ? [] : await prisma.payment.findMany({
    where: { id: { in: initialProjection.proposedRows.map((row) => row.id) } },
    select: Object.fromEntries(LEGACY_PAYMENT_PERSISTED_FIELDS.map((field) => [field, true])),
  });
  const projection = projectLegacyPayments({ ...projectionInputs, existingRows });

  console.log(`Target shop: ${shop.name} (${shop.id})`);
  console.log(`Report basis: ${projection.label}`);
  console.log(`Staged AR rows: ${projection.stagedArRowCount}`);
  console.log(`Eligible matched Invoices: ${projection.eligibleInvoiceCount}`);
  console.log(`Matched / unmatched Invoices: ${projection.matchedInvoiceCount} / ${projection.unmatchedInvoiceCount}`);
  console.log(`Matched / unmatched Customers: ${projection.matchedCustomerCount} / ${projection.unmatchedCustomerCount}`);
  console.log(`Unmatched zero-payment / nonzero-payment source orders: ${projection.counts.unmatchedZeroPaymentCount} / ${projection.counts.unmatchedNonzeroPaymentCount}`);
  console.log(`Proposed Payment rows: ${projection.proposedRows.length}`);
  console.log(`Total proposed Payment amount: ${centsToDecimal(projection.proposedPaymentAmountCents)}`);
  console.log(`Payment rows to insert / unchanged / conflicting: ${projection.existing.inserts.length} / ${projection.existing.unchanged.length} / ${projection.existing.conflicts.length}`);
  console.log(`Zero / partial / fully paid orders: ${projection.counts.zeroPaymentOrderCount} / ${projection.counts.partialPaymentOrderCount} / ${projection.counts.fullyPaidOrderCount}`);
  console.log(`Split-tender orders: ${projection.counts.splitTenderOrderCount}`);
  console.log(`Identical duplicate / conflicting source keys: ${projection.counts.identicalDuplicateSourceKeyCount} / ${projection.counts.conflictingSourceKeyCount}`);
  console.log(`Duplicate deterministic keys: ${projection.counts.duplicateDeterministicKeyCount}`);
  console.log(`Invalid or missing Invoice date proxies: ${projection.counts.invalidProxyDateCount}`);
  console.log(`Tender / Invoice reconciliation mismatches: ${projection.counts.tenderMismatchCount} / ${projection.counts.invoiceMismatchCount}`);
  console.log("Source tender buckets:");
  for (const { bucket } of LEGACY_TENDER_BUCKETS) printAggregate(`  ${bucket}`, projection.sourceBucketTotals[bucket]);
  console.log("Normalized methods:");
  for (const method of ["cash", "check", "card", "internal", "other"]) printAggregate(`  ${method}`, projection.normalizedMethodTotals[method]);
  console.log(`Period totals (${projection.label}):`);
  for (const [period, aggregate] of Object.entries(projection.periodTotals).sort()) printAggregate(`  ${period}`, aggregate);
  console.log("Unsupported/source-context fields with meaningful values:");
  if (projection.unsupportedFieldClassifications.length === 0) console.log("  none");
  for (const item of projection.unsupportedFieldClassifications) {
    console.log(`  ${item.field} [${item.classification}]: ${item.count} / ${centsToDecimal(item.amountCents)}`);
  }
  console.log(`Warnings: ${projection.warnings.length}`);
  console.log(`Fatal issues: ${projection.fatalIssues.length}`);

  if (projection.fatalIssues.length > 0) throw new Error("Legacy payment safety validation failed; no writes were attempted.");
  const writeResult = await executeLegacyPaymentInsertTransaction({ confirmedWrite: options.confirmedWrite, prisma, projection });
  console.log(`Database writes performed: ${writeResult.databaseWrites}`);
} finally {
  await prisma.$disconnect();
}
