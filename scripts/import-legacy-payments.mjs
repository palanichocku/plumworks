import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { aliasResolutionMaps, resolveLegacyCustomerId } from "./lib/legacy-customer-recovery.mjs";
import { centsToDecimal } from "./lib/legacy-invoice-financials.mjs";
import {
  classifyLegacyPaymentRows,
  executeLegacyPaymentInsertTransaction,
  LEGACY_PAYMENT_PERSISTED_FIELDS,
  LEGACY_TENDER_BUCKETS,
  parseLegacyPaymentImportArguments,
  planLegacyPaymentOrder,
} from "./lib/legacy-payment-import.mjs";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

const options = parseLegacyPaymentImportArguments(process.argv.slice(2));
console.log(`Execution mode: ${options.dryRun ? "DRY RUN" : "CONFIRMED WRITE"}`);
console.log(`Confirmation status: ${options.confirmationStatus}`);
console.log(`Database writes permitted: ${options.confirmedWrite ? "yes" : "no"}`);
console.log("Historical paidAt proxy: transformed operational Invoice.invoiceDate (exact legacy receipt timestamps did not survive).");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

function add(map, key, cents) {
  map.set(key, (map.get(key) ?? 0) + cents);
}

function periodKey(date) {
  const time = date.getTime();
  if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 1, 1)) return ["all history", "January 2026", "January-June 2026"];
  if (time >= Date.UTC(2026, 1, 1) && time < Date.UTC(2026, 6, 1)) return ["all history", "January-June 2026"];
  if (time >= Date.UTC(2025, 0, 1) && time < Date.UTC(2026, 0, 1)) return ["all history", "calendar year 2025"];
  return ["all history"];
}

function printMethodAmounts(label, amounts) {
  console.log(`${label}:`);
  for (const method of ["cash", "check", "card", "internal", "other"]) {
    console.log(`  ${method}: ${centsToDecimal(amounts.get(method) ?? 0)}`);
  }
  console.log(`  total: ${centsToDecimal([...amounts.values()].reduce((sum, cents) => sum + cents, 0))}`);
}

function duplicateValues(rows, key) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

try {
  // Passing null deliberately prevents an environment variable from silently selecting a shop.
  const shopId = await resolveSingleShopId(prisma, options.shopId ?? null);
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { id: true, name: true } });
  const latest = await prisma.legacyImportRun.findFirst({
    where: { shopId, rawAr: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) throw new Error("No staged RawLegacyAr import run was found.");

  const [sourceRows, invoices, customers, aliases] = await Promise.all([
    prisma.rawLegacyAr.findMany({
      where: { shopId, legacyImportRunId: latest.id },
      select: { legacyRoNo: true, legacyCustno: true, rawData: true },
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

  const blankSourceRos = sourceRows.filter((row) => !row.legacyRoNo?.trim()).length;
  if (blankSourceRos) throw new Error(`${blankSourceRos} RawLegacyAr row(s) have no legacy RO number.`);
  const sourceDuplicates = duplicateValues(sourceRows, (row) => row.legacyRoNo.trim());
  if (sourceDuplicates.size) throw new Error(`Duplicate RawLegacyAr RO numbers: ${[...sourceDuplicates].join(", ")}`);
  const invoiceDuplicates = duplicateValues(invoices, (row) => row.legacyRoNo.trim());
  if (invoiceDuplicates.size) throw new Error(`Duplicate operational shopId + legacyRoNo values: ${[...invoiceDuplicates].join(", ")}`);

  const invoiceByRo = new Map(invoices.map((invoice) => [invoice.legacyRoNo.trim(), invoice]));
  const { exactCustomerIds, aliasCustomerIds } = aliasResolutionMaps(customers, aliases);
  const plans = [];
  const unmatched = [];
  let customerMismatches = 0;
  for (const source of sourceRows) {
    const ro = source.legacyRoNo.trim();
    const invoice = invoiceByRo.get(ro) ?? null;
    if (invoice) {
      const expectedCustomerId = resolveLegacyCustomerId(source.legacyCustno?.trim(), exactCustomerIds, aliasCustomerIds);
      if (!expectedCustomerId || expectedCustomerId !== invoice.customerId) customerMismatches += 1;
    } else unmatched.push(ro);
    plans.push(planLegacyPaymentOrder({ shopId, source: { ...source, legacyRoNo: ro }, invoice }));
  }

  const matchedPlans = plans.filter((plan) => plan.matched);
  const proposedRows = matchedPlans.flatMap((plan) => plan.rows);
  const tenderMismatches = plans.filter((plan) => !plan.tenderReconciles);
  const invoiceMismatches = matchedPlans.filter((plan) => !plan.invoiceReconciles);
  const positiveInvoices = matchedPlans.filter((plan) => plan.paymentCents > 0).length;
  const zeroInvoices = matchedPlans.filter((plan) => plan.paymentCents === 0).length;
  const splitInvoices = matchedPlans.filter((plan) => plan.rows.length > 1);

  const existing = proposedRows.length === 0 ? [] : await prisma.payment.findMany({
    where: { id: { in: proposedRows.map((row) => row.id) } },
    select: Object.fromEntries(LEGACY_PAYMENT_PERSISTED_FIELDS.map((field) => [field, true])),
  });
  const classification = classifyLegacyPaymentRows(proposedRows, existing);
  const bucketRows = new Map();
  const bucketAmounts = new Map();
  const methodRows = new Map();
  const methodAmounts = new Map();
  const periods = new Map();
  for (const label of ["all history", "calendar year 2025", "January-June 2026", "January 2026"]) periods.set(label, new Map());
  for (const row of proposedRows) {
    add(bucketRows, row.sourceBucket, 1);
    add(bucketAmounts, row.sourceBucket, row.amountCents);
    add(methodRows, row.method, 1);
    add(methodAmounts, row.method, row.amountCents);
    for (const label of periodKey(row.paidAt)) add(periods.get(label), row.method, row.amountCents);
  }

  console.log(`Target shop: ${shop.name} (${shop.id})`);
  console.log(`Source AR orders reviewed: ${sourceRows.length}`);
  console.log(`Operational invoices matched: ${matchedPlans.length}`);
  console.log(`Source orders without operational invoice: ${unmatched.length}`);
  console.log(`Unmatched legacy ROs: ${unmatched.length ? unmatched.join(", ") : "none"}`);
  console.log(`Operational invoice customer mismatches: ${customerMismatches}`);
  console.log(`Positive-payment operational invoices: ${positiveInvoices}`);
  console.log(`Zero-dollar operational invoices: ${zeroInvoices}`);
  console.log(`Split-tender invoices: ${splitInvoices.length}`);
  console.log(`Tender rows proposed: ${proposedRows.length}`);
  console.log(`Payment rows to insert: ${classification.inserts.length}`);
  console.log(`Payment rows unchanged: ${classification.unchanged.length}`);
  console.log(`Payment conflicts: ${classification.conflicts.length}`);
  console.log(`Tender reconciliation matches: ${plans.length - tenderMismatches.length}`);
  console.log(`Tender reconciliation mismatches: ${tenderMismatches.length}`);
  console.log(`Invoice paid-total reconciliation matches: ${matchedPlans.length - invoiceMismatches.length}`);
  console.log(`Invoice paid-total mismatches: ${invoiceMismatches.length}`);
  console.log("Rows and amounts by source bucket:");
  for (const { bucket } of LEGACY_TENDER_BUCKETS) {
    console.log(`  ${bucket}: ${bucketRows.get(bucket) ?? 0} / ${centsToDecimal(bucketAmounts.get(bucket) ?? 0)}`);
  }
  console.log("Rows and amounts by normalized method:");
  for (const method of ["cash", "check", "card", "internal", "other"]) {
    console.log(`  ${method}: ${methodRows.get(method) ?? 0} / ${centsToDecimal(methodAmounts.get(method) ?? 0)}`);
  }
  for (const [label, amounts] of periods) printMethodAmounts(label, amounts);
  const januarySplit = splitInvoices.filter((plan) => {
    const date = invoiceByRo.get(plan.legacyRoNo).invoiceDate;
    return date >= new Date(Date.UTC(2026, 0, 1)) && date < new Date(Date.UTC(2026, 1, 1));
  });
  console.log(`January 2026 split-tender invoices: ${januarySplit.length}`);
  for (const plan of januarySplit) {
    console.log(`  RO ${plan.legacyRoNo}: ${plan.rows.map((row) => `${row.method} ${row.amount}`).join(", ")} / total ${centsToDecimal(plan.totalCents)}`);
  }

  if (customerMismatches || tenderMismatches.length || invoiceMismatches.length || classification.conflicts.length) {
    throw new Error("Legacy payment safety validation failed; no writes were attempted.");
  }
  const writeResult = await executeLegacyPaymentInsertTransaction({ confirmedWrite: options.confirmedWrite, prisma, proposedRows });
  console.log(`Database writes performed: ${writeResult.databaseWrites}`);
} finally {
  await prisma.$disconnect();
}
