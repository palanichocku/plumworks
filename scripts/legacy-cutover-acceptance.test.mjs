import assert from "node:assert/strict";
import test from "node:test";
import { projectLegacyInvoicePaymentInputs } from "./lib/legacy-invoice-projection.mjs";
import { verifyFreshLegacyCutover } from "./lib/legacy-cutover-acceptance.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const rawAr = [{ legacyRoNo: "100", legacyCustno: "C1", rawData: { ODOMETER: "128K", TOTAL: "10", PAYMENT: "0", BALANCE: "10", PARTS: "10", LABOR: "0", TAX: "0", TAX2: "0", TAX3: "0", TAX4: "0", TAX5: "0", TAX6: "0", DATE_SOLD: "20260801" } }];
const rawFinal = [{ legacyRoNo: "100", legacyCustno: "C1", rawData: { PARTNO: "P1", DESC: "Part", QTY: "1", PRICE: "10", SOURCE: "SUP1" } }];
const rawLabor = [{ legacyRoNo: "100", legacyCustno: "C1", rawData: { LABOR_DONE: "Courtesy inspection", HOURS: "0", LABORRATE: "0" } }];

function projection(overrides = {}) {
  const result = projectLegacyInvoicePaymentInputs({ shopId, importRunId: "run", rawFinal, rawLabor, rawAr, resolvedCustomers: [{ legacyCustno: "C1", customerId: "customer" }] });
  return { ...result, ...overrides };
}

function verify(invoiceProjection = projection()) {
  return verifyFreshLegacyCutover({
    shopId, rawAr, rawFinal,
    openPartRows: [{ legacyRowKey: "orders:200:1", legacyRoNo: "200", legacyCustno: "C1", legacyCarno: "V1", rawData: { ODOMETER: "45,000", SOURCE: "SRC2" } }],
    openLaborRows: [{ legacyRowKey: "labor:200:1", legacyRoNo: "200", legacyCustno: "C1", legacyCarno: "V1", rawData: { HOURS: "0", LABORRATE: "0" } }],
    invoiceProjection, customerIds: new Set(["C1"]), vehicleIds: new Set(["V1"]),
  });
}

test("fresh projection preserves completed/open mileage and exact Vendor codes with zero recovery delta", () => {
  const report = verify();
  assert.equal(report.mileage.completedDestinationMatches, 1);
  assert.equal(report.mileage.openDestinationMatches, 1);
  assert.equal(report.vendor.completedExactDestinationMatches, 1);
  assert.equal(report.vendor.openMatches, 1);
  assert.equal(report.recoveryBackfill.invoiceOdometer.proposedUpdates, 0);
  assert.equal(report.recoveryBackfill.invoicePartVendor.proposedUpdates, 0);
  assert.equal(report.blockingIssues, 0);
});

test("zero-value legacy labor stays ordinary and imported open orders stay historical only", () => {
  const report = verify();
  assert.equal(report.complimentary.importedLegacyLaborRows, 2);
  assert.equal(report.complimentary.producedComplimentary, 0);
  assert.equal(report.operational.importedHistoricalOrders, 1);
  assert.equal(report.operational.operationallyEligibleImportedOrders, 0);
  assert.equal(report.operational.historicalDirectDetailEligible, 1);
});

test("mileage and Vendor mismatches block rehearsal clearly", () => {
  const mileage = projection(); mileage.invoices[0].odometer = 999;
  assert.ok(verify(mileage).mileage.completedMismatches > 0);
  const vendor = projection(); vendor.parts[0].vendorNameSnapshot = "OTHER";
  assert.ok(verify(vendor).vendor.completedMismatches > 0);
});

test("ambiguous authoritative mileage blocks fresh projection", () => {
  const result = projectLegacyInvoicePaymentInputs({ shopId, importRunId: "run", rawFinal, rawLabor, rawAr: [...rawAr, { ...rawAr[0], rawData: { ...rawAr[0].rawData, ODOMETER: "129K" } }], resolvedCustomers: [{ legacyCustno: "C1", customerId: "customer" }] });
  assert.ok(result.fatalIssues.some((issue) => issue.code === "conflicting-ar-odometer-values"));
});

test("an unavailable duplicate does not override the one normalized mileage for the exact RO", () => {
  const duplicatedRawAr = [...rawAr, { ...rawAr[0], rawData: { ...rawAr[0].rawData, ODOMETER: "" } }];
  const invoiceProjection = projectLegacyInvoicePaymentInputs({ shopId, importRunId: "run", rawFinal, rawLabor, rawAr: duplicatedRawAr, resolvedCustomers: [{ legacyCustno: "C1", customerId: "customer" }] });
  const report = verifyFreshLegacyCutover({ shopId, rawAr: duplicatedRawAr, rawFinal, openPartRows: [], openLaborRows: [], invoiceProjection, customerIds: new Set(["C1"]), vehicleIds: new Set(["V1"]) });
  assert.equal(invoiceProjection.invoices[0].odometer, 128000);
  assert.equal(report.mileage.completedMismatches, 0);
});
