import { Prisma } from "@prisma/client";

export type NormalizedPaymentMethod = "cash" | "check" | "card" | "internal" | "other";

export type PaymentAggregationRow = {
  amount: Prisma.Decimal | string | number;
  method: string | null;
  invoiceId: string | null;
};

export type DailySalesInvoiceInput = {
  id: string;
  paidTotal: Prisma.Decimal | string | number;
  total: Prisma.Decimal | string | number;
  partsTotal: Prisma.Decimal | string | number;
  laborTotal: Prisma.Decimal | string | number;
  subtotal: Prisma.Decimal | string | number;
  shopSuppliesAmount: Prisma.Decimal | string | number;
  taxTotal: Prisma.Decimal | string | number;
  legacyCharges: Array<{ amount: Prisma.Decimal | string | number }>;
};

const zero = () => new Prisma.Decimal(0);

export function normalizePaymentMethod(method: string | null | undefined): NormalizedPaymentMethod {
  const normalized = method?.trim().toLowerCase();
  return normalized === "cash" || normalized === "check" || normalized === "card" || normalized === "internal"
    ? normalized
    : "other";
}

export function aggregatePaymentRows(rows: PaymentAggregationRow[]) {
  const totals = {
    cashTotal: zero(),
    checkTotal: zero(),
    cardTotal: zero(),
    internalTotal: zero(),
    otherTotal: zero(),
  };
  const invoiceCounts = new Map<string, number>();

  for (const row of rows) {
    const key = `${normalizePaymentMethod(row.method)}Total` as keyof typeof totals;
    totals[key] = totals[key].plus(row.amount);
    if (row.invoiceId) invoiceCounts.set(row.invoiceId, (invoiceCounts.get(row.invoiceId) ?? 0) + 1);
  }

  return {
    ...totals,
    paymentTotal: Object.values(totals).reduce((sum, value) => sum.plus(value), zero()),
    paymentRowCount: rows.length,
    paidInvoiceCount: invoiceCounts.size,
    splitTenderInvoiceCount: [...invoiceCounts.values()].filter((count) => count > 1).length,
  };
}

export function buildDailySalesInvoiceRows<T extends DailySalesInvoiceInput>(
  invoices: T[],
  paymentRows: PaymentAggregationRow[],
) {
  const paymentsByInvoice = new Map<string, PaymentAggregationRow[]>();
  for (const payment of paymentRows) {
    if (!payment.invoiceId) continue;
    const existing = paymentsByInvoice.get(payment.invoiceId) ?? [];
    existing.push(payment);
    paymentsByInvoice.set(payment.invoiceId, existing);
  }

  return invoices.map((invoice) => {
    const invoicePayments = paymentsByInvoice.get(invoice.id) ?? [];
    const aggregated = aggregatePaymentRows(invoicePayments);
    const otherInternalTotal = aggregated.internalTotal.plus(aggregated.otherTotal);
    const legacyChargeTotal = invoice.legacyCharges.reduce((sum, charge) => sum.plus(charge.amount), zero());
    const discountsTotal = new Prisma.Decimal(invoice.subtotal)
      .plus(invoice.shopSuppliesAmount)
      .plus(invoice.taxTotal)
      .plus(legacyChargeTotal)
      .minus(invoice.total);
    const paymentDifference = new Prisma.Decimal(invoice.paidTotal).minus(aggregated.paymentTotal);
    const totalPaymentDifference = new Prisma.Decimal(invoice.total).minus(aggregated.paymentTotal);
    return {
      ...invoice,
      cashTotal: aggregated.cashTotal,
      checkTotal: aggregated.checkTotal,
      cardTotal: aggregated.cardTotal,
      otherInternalTotal,
      paymentTotal: aggregated.paymentTotal,
      paymentRowCount: aggregated.paymentRowCount,
      isSplitTender: aggregated.paymentRowCount > 1,
      paymentDifference,
      totalPaymentDifference,
      hasPaymentMismatch: !paymentDifference.isZero() || !totalPaymentDifference.isZero(),
      discountsTotal,
      legacyChargeTotal,
    };
  });
}

export function aggregateDailySalesInvoiceRows(rows: ReturnType<typeof buildDailySalesInvoiceRows>) {
  return rows.reduce((totals, row) => ({
    partsTotal: totals.partsTotal.plus(row.partsTotal),
    laborTotal: totals.laborTotal.plus(row.laborTotal),
    shopSuppliesTotal: totals.shopSuppliesTotal.plus(row.shopSuppliesAmount),
    ordinarySalesTaxTotal: totals.ordinarySalesTaxTotal.plus(row.taxTotal),
    grossSalesTotal: totals.grossSalesTotal.plus(row.total),
    cashTotal: totals.cashTotal.plus(row.cashTotal),
    checkTotal: totals.checkTotal.plus(row.checkTotal),
    cardTotal: totals.cardTotal.plus(row.cardTotal),
    otherInternalTotal: totals.otherInternalTotal.plus(row.otherInternalTotal),
  }), {
    partsTotal: zero(), laborTotal: zero(), shopSuppliesTotal: zero(), ordinarySalesTaxTotal: zero(),
    grossSalesTotal: zero(), cashTotal: zero(), checkTotal: zero(), cardTotal: zero(), otherInternalTotal: zero(),
  });
}

type InvoiceAggregate = {
  _count: { _all: number };
  _sum: {
    partsTotal: Prisma.Decimal | null;
    laborTotal: Prisma.Decimal | null;
    subtotal: Prisma.Decimal | null;
    shopSuppliesAmount: Prisma.Decimal | null;
    taxTotal: Prisma.Decimal | null;
    total: Prisma.Decimal | null;
    paidTotal: Prisma.Decimal | null;
  };
};

export function buildSalesSummary(invoiceAggregate: InvoiceAggregate, legacyChargeAmount: Prisma.Decimal | null) {
  const partsTotal = invoiceAggregate._sum.partsTotal ?? zero();
  const laborTotal = invoiceAggregate._sum.laborTotal ?? zero();
  const subtotal = invoiceAggregate._sum.subtotal ?? zero();
  const shopSuppliesTotal = invoiceAggregate._sum.shopSuppliesAmount ?? zero();
  const ordinarySalesTaxTotal = invoiceAggregate._sum.taxTotal ?? zero();
  const legacyChargeTotal = legacyChargeAmount ?? zero();
  const grossSalesTotal = invoiceAggregate._sum.total ?? zero();
  const invoicePaidTotal = invoiceAggregate._sum.paidTotal ?? zero();
  // No dedicated discount column exists. The persisted invoice equation makes
  // discounts/reductions the difference between components and authoritative total.
  const discountsTotal = subtotal
    .plus(shopSuppliesTotal)
    .plus(ordinarySalesTaxTotal)
    .plus(legacyChargeTotal)
    .minus(grossSalesTotal);

  return {
    invoiceCount: invoiceAggregate._count._all,
    partsTotal,
    laborTotal,
    subtotal,
    shopSuppliesTotal,
    ordinarySalesTaxTotal,
    discountsTotal,
    legacyChargeTotal,
    grossSalesTotal,
    invoicePaidTotal,
  };
}

export function reconciliationDifferences(
  sales: Pick<ReturnType<typeof buildSalesSummary>, "grossSalesTotal" | "invoicePaidTotal">,
  payments: Pick<ReturnType<typeof aggregatePaymentRows>, "paymentTotal">,
) {
  return {
    salesPaymentDifference: sales.grossSalesTotal.minus(payments.paymentTotal),
    invoicePaidPaymentDifference: sales.invoicePaidTotal.minus(payments.paymentTotal),
  };
}

export function inclusiveUtcDateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const requestedEnd = new Date(`${to}T00:00:00Z`);
  const safeEnd = requestedEnd < start ? start : requestedEnd;
  const endExclusive = new Date(safeEnd);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}
