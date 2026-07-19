import assert from "node:assert/strict";
import test from "node:test";
import {
  projectWritableInvoicePeriods,
  skippedOrderDiagnostic,
} from "./lib/legacy-invoice-projection.mjs";

const money = (totalCents = 0) => ({
  totalCents,
  partsCents: totalCents,
  laborCents: 0,
  subtotalCents: totalCents,
  shopSuppliesCents: 0,
  salesTaxCents: 0,
  legacyAdditionalChargesCents: 0,
  discountsCents: 0,
  paidCents: totalCents,
});
const link = (date, totalCents = 0) => ({ invoiceDate: new Date(`${date}T00:00:00Z`), financials: money(totalCents) });

test("11666 candidates with one skipped record project 11665 operational invoices", () => {
  const writable = [
    ...Array.from({ length: 460 }, () => link("2025-07-01")),
    ...Array.from({ length: 25 }, () => link("2026-01-15")),
    ...Array.from({ length: 170 }, () => link("2026-04-15")),
    ...Array.from({ length: 11010 }, () => link("2024-01-01")),
  ];
  const sourceCandidates = 11666;
  const skipped = [skippedOrderDiagnostic("18181", "missing customer link")];
  const reconciliationMatches = 11666;
  const projected = projectWritableInvoicePeriods(writable);
  assert.equal(sourceCandidates, 11666);
  assert.equal(writable.length, 11665);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].legacyRoNo, "18181");
  assert.equal(reconciliationMatches, 11666);
  assert.equal(projected.all.count, 11665);
  assert.equal(projected["2025"].count, 460);
  assert.equal(projected["2026-01"].count, 25);
  assert.equal(projected["2026-H1"].count, 195);
});

test("zero-dollar and nonzero skipped records are excluded from projected count and money", () => {
  const writable = [link("2024-01-01", 1250)];
  const skipped = [
    { ...skippedOrderDiagnostic("ZERO", "hard safety gate"), financials: money(0) },
    { ...skippedOrderDiagnostic("NONZERO", "hard safety gate"), financials: money(9900) },
  ];
  const projected = projectWritableInvoicePeriods(writable);
  assert.deepEqual(skipped.map((row) => row.legacyRoNo), ["ZERO", "NONZERO"]);
  assert.equal(projected.all.count, 1);
  assert.equal(projected.all.totalCents, 1250);
  assert.equal(projected.all.subtotalCents, 1250);
});
