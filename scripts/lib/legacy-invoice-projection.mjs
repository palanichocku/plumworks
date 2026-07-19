export function emptyProjectedInvoiceTotals() {
  return {
    count: 0,
    totalCents: 0,
    partsCents: 0,
    laborCents: 0,
    subtotalCents: 0,
    shopSuppliesCents: 0,
    salesTaxCents: 0,
    legacyChargesCents: 0,
    discountsCents: 0,
    paidCents: 0,
  };
}

export function addProjectedInvoice(totals, financials) {
  totals.count += 1;
  totals.totalCents += financials.totalCents;
  totals.partsCents += financials.partsCents;
  totals.laborCents += financials.laborCents;
  totals.subtotalCents += financials.subtotalCents;
  totals.shopSuppliesCents += financials.shopSuppliesCents;
  totals.salesTaxCents += financials.salesTaxCents;
  totals.legacyChargesCents += financials.legacyAdditionalChargesCents;
  totals.discountsCents += financials.discountsCents;
  totals.paidCents += financials.paidCents;
}

export function projectWritableInvoicePeriods(writableLinks) {
  const totals = {
    all: emptyProjectedInvoiceTotals(),
    "2025": emptyProjectedInvoiceTotals(),
    "2026-H1": emptyProjectedInvoiceTotals(),
    "2026-01": emptyProjectedInvoiceTotals(),
  };
  for (const link of writableLinks) {
    addProjectedInvoice(totals.all, link.financials);
    const time = link.invoiceDate.getTime();
    if (time >= Date.UTC(2025, 0, 1) && time < Date.UTC(2026, 0, 1)) addProjectedInvoice(totals["2025"], link.financials);
    if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 6, 1)) addProjectedInvoice(totals["2026-H1"], link.financials);
    if (time >= Date.UTC(2026, 0, 1) && time < Date.UTC(2026, 1, 1)) addProjectedInvoice(totals["2026-01"], link.financials);
  }
  return totals;
}

export function skippedOrderDiagnostic(legacyRoNo, reason) {
  return { legacyRoNo, reason };
}
