import { aliasResolutionMaps, resolveLegacyCustomerId } from "./legacy-customer-recovery.mjs";
import {
  LEGACY_PAYMENT_PERSISTED_FIELDS,
  projectLegacyPayments,
} from "./legacy-payment-import.mjs";

export async function loadLegacyPaymentStageProjection({ prisma, shopId, importRunId, paymentDatePolicy }) {
  const importRun = await prisma.legacyImportRun.findFirst({
    where: { id: importRunId, shopId, rawAr: { some: {} } },
    select: { id: true, shopId: true },
  });
  if (!importRun) throw new Error("Payment stage import-run mismatch: the exact Invoice/AR run is unavailable for this shop.");
  const [stagedArRows, invoices, customers, aliases] = await Promise.all([
    prisma.rawLegacyAr.findMany({
      where: { shopId, legacyImportRunId: importRunId },
      select: { id: true, shopId: true, legacyImportRunId: true, legacyRoNo: true, legacyCustno: true, rawData: true },
      orderBy: { id: "asc" },
    }),
    prisma.invoice.findMany({
      where: { shopId, legacyRoNo: { not: null } },
      select: { id: true, shopId: true, legacyRoNo: true, customerId: true, invoiceDate: true, paidTotal: true, total: true },
    }),
    prisma.customer.findMany({
      where: { shopId, legacyCustno: { not: null } },
      select: { id: true, legacyCustno: true, legacySourceTable: true },
    }),
    prisma.customerLegacyAlias.findMany({
      where: { shopId },
      select: { customerId: true, aliasLegacyCustno: true },
    }),
  ]);
  if (!stagedArRows.length) throw new Error("Payment stage import run contains no staged AR rows.");
  if (invoices.some((invoice) => invoice.shopId !== shopId)) throw new Error("Payment stage Invoice shop mismatch.");
  const { exactCustomerIds, aliasCustomerIds } = aliasResolutionMaps(customers, aliases);
  const customerTypeById = new Map(customers.map((customer) => [customer.id,
    customer.legacySourceTable === "legacy-customer-recovery.json" ? "recovered" : "normal"]));
  const sourceCustomerIds = new Set(stagedArRows.map((row) => row.legacyCustno?.trim()).filter(Boolean));
  const resolvedCustomers = [...sourceCustomerIds].flatMap((legacyCustno) => {
    const customerId = resolveLegacyCustomerId(legacyCustno, exactCustomerIds, aliasCustomerIds);
    if (!customerId) return [];
    return [{
      legacyCustno,
      customerId,
      resolutionType: aliasCustomerIds.has(legacyCustno) && !exactCustomerIds.has(legacyCustno)
        ? "alias"
        : customerTypeById.get(customerId) ?? "normal",
    }];
  });
  const inputs = { shopId, importRunId, stagedArRows, invoices, resolvedCustomers, paymentDatePolicy };
  const initial = projectLegacyPayments(inputs);
  const existingRows = initial.proposedRows.length ? await prisma.payment.findMany({
    where: { id: { in: initial.proposedRows.map((row) => row.id) } },
    select: Object.fromEntries(LEGACY_PAYMENT_PERSISTED_FIELDS.map((field) => [field, true])),
  }) : [];
  return { projection: projectLegacyPayments({ ...inputs, existingRows }), inputs, importRun };
}

export function validateApprovedPaymentUnresolved({ projection, recoveryPlan }) {
  const approved = new Set((recoveryPlan?.unresolvedEntries ?? []).map((entry) => `${entry.legacyRoNo}\n${entry.legacyCustno}`));
  const approvedZero = [];
  const approvedNonzero = [];
  const unexpected = [];
  for (const record of projection.unmatchedRecords) {
    const key = `${record.legacyRoNo}\n${record.legacyCustno ?? ""}`;
    if (!approved.has(key)) unexpected.push(record);
    else if (record.paymentCents === 0) approvedZero.push(record);
    else approvedNonzero.push(record);
  }
  const fatalIssues = [];
  if (approvedNonzero.length) fatalIssues.push({ code: "approved-unresolved-nonzero-payment", count: approvedNonzero.length });
  if (unexpected.length) fatalIssues.push({ code: "unexpected-unresolved-payment", count: unexpected.length });
  return { approvedZero, approvedNonzero, unexpected, fatalIssues };
}

export function verifyPersistedLegacyPayments({ projection, persistedPayments, accountsReceivable }) {
  const expectedPaymentIds = new Set(projection.proposedRows.map((row) => row.id));
  const unexpectedPaymentRows = persistedPayments.filter((payment) => !expectedPaymentIds.has(payment.id)).length;
  const paymentsByInvoice = new Map();
  for (const payment of persistedPayments) {
    const cents = Math.round(Number(payment.amount) * 100);
    paymentsByInvoice.set(payment.invoiceId, (paymentsByInvoice.get(payment.invoiceId) ?? 0) + cents);
  }
  const arByInvoice = new Map(accountsReceivable.map((row) => [row.invoiceId, Math.round(Number(row.balance) * 100)]));
  let paymentSumMismatches = 0;
  let balanceMismatches = 0;
  for (const reconciliation of projection.perInvoiceReconciliation) {
    const invoiceId = reconciliation.invoiceId;
    if (!invoiceId && reconciliation.paymentCents === 0) continue;
    const paymentCents = paymentsByInvoice.get(invoiceId) ?? 0;
    if (paymentCents !== reconciliation.paymentCents) paymentSumMismatches += 1;
    if (!arByInvoice.has(invoiceId) || reconciliation.totalCents - paymentCents !== arByInvoice.get(invoiceId)) balanceMismatches += 1;
  }
  return {
    paymentSumMismatches,
    balanceMismatches,
    deterministicConflicts: projection.existing.conflicts.length,
    unexpectedPaymentRows,
    fatalIssues: [
      ...(paymentSumMismatches ? [{ code: "persisted-payment-sum-mismatch", count: paymentSumMismatches }] : []),
      ...(balanceMismatches ? [{ code: "persisted-ar-balance-mismatch", count: balanceMismatches }] : []),
      ...(unexpectedPaymentRows ? [{ code: "unexpected-persisted-payment", count: unexpectedPaymentRows }] : []),
    ],
  };
}

export async function runPaymentBeforeOpenOrders({ runPayment, runOpenOrders }) {
  const result = await runPayment();
  await runOpenOrders(result);
  return result;
}
