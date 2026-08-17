import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attachFinalizedInvoiceHeaders,
  finalizedInvoiceHeaderValues,
  readLegacyFinalizedInvoiceHeaders,
} from "./lib/legacy-finalized-invoice-header.mjs";
import { projectLegacyInvoicePaymentInputs } from "./lib/legacy-invoice-projection.mjs";

function header(ro, complaint, recommendation, overrides = {}) {
  return {
    legacyRoNo: ro,
    legacyCustno: overrides.legacyCustno ?? "10",
    legacyCarno: overrides.legacyCarno ?? "20",
    rawData: {
      RO_NO: ro, CUSTNO: overrides.legacyCustno ?? "10",
      CARNO: overrides.legacyCarno ?? "20", DATE_SOLD: overrides.dateSold ?? "20260815",
      VNOTES: complaint, RECOMEND: recommendation,
    },
  };
}

function ar(ro = "100", overrides = {}) {
  return {
    legacyRoNo: ro, legacyCustno: "10", legacyCarno: "20",
    rawData: {
      CUSTNO: "10", CARNO: "20", DATE_SOLD: "20260815", ODOMETER: "12345",
      PARTS: "100", LABOR: "50", TAX: "6", TAX2: "4", TAX3: "0", TAX4: "0",
      TAX5: "0", TAX6: "0", TOTAL: "160", PAYMENT: "10", BALANCE: "150",
      ...overrides,
    },
  };
}

function fixture() {
  const descriptors = [
    { name: "CUSTNO", type: "N", length: 8 }, { name: "RO_NO", type: "N", length: 6 },
    { name: "DATE_SOLD", type: "D", length: 8 }, { name: "CARNO", type: "N", length: 8 },
    { name: "VNOTES", type: "M", length: 4 }, { name: "RECOMEND", type: "M", length: 4 },
  ];
  const headerLength = 32 + descriptors.length * 32 + 1;
  const recordLength = 1 + descriptors.reduce((sum, field) => sum + field.length, 0);
  const dbf = Buffer.alloc(headerLength + recordLength);
  dbf.writeUInt32LE(1, 4); dbf.writeUInt16LE(headerLength, 8); dbf.writeUInt16LE(recordLength, 10);
  let descriptorOffset = 32;
  for (const field of descriptors) {
    dbf.write(field.name, descriptorOffset, "ascii"); dbf[descriptorOffset + 11] = field.type.charCodeAt(0);
    dbf[descriptorOffset + 16] = field.length; descriptorOffset += 32;
  }
  dbf[descriptorOffset] = 0x0d; dbf[headerLength] = 0x20;
  let offset = headerLength + 1;
  for (const value of ["10".padStart(8), "100".padStart(6), "20260815", "20".padStart(8)]) {
    dbf.write(value, offset, "ascii"); offset += value.length;
  }
  dbf.writeUInt32LE(1, offset); dbf.writeUInt32LE(3, offset + 4);
  const fpt = Buffer.alloc(320); fpt.writeUInt16BE(64, 6);
  for (const [pointer, value] of [[1, " Concern "], [3, " LINE ONE\r\nLINE TWO "]]) {
    const encoded = Buffer.from(value, "latin1"); const memoOffset = pointer * 64;
    fpt.writeUInt32BE(1, memoOffset); fpt.writeUInt32BE(encoded.length, memoOffset + 4); encoded.copy(fpt, memoOffset + 8);
  }
  return { dbf, fpt };
}

test("finalsold VNOTES and RECOMEND decode exactly with outer trim and multiline preservation", () => {
  assert.deepEqual(readLegacyFinalizedInvoiceHeaders(fixture().dbf, fixture().fpt), [{
    legacyRoNo: "100", legacyCustno: "10", legacyCarno: "20",
    rawData: { CUSTNO: "10", RO_NO: "100", DATE_SOLD: "20260815", CARNO: "20", VNOTES: "Concern", RECOMEND: "LINE ONE\r\nLINE TWO" },
  }]);
});

test("blank values map to null and exact-RO attachment does not cross-map", () => {
  const result = attachFinalizedInvoiceHeaders([ar("100"), ar("101")], [header("100", " ", "")]);
  assert.deepEqual(finalizedInvoiceHeaderValues(result.rows[0]), { customerComplaint: null, recommendation: null });
  assert.deepEqual(finalizedInvoiceHeaderValues(result.rows[1]), { customerComplaint: null, recommendation: null });
  assert.equal(result.counts.missingForAr, 1);
});

test("duplicate equivalent headers are accepted and conflicting headers fail closed", () => {
  const same = header("100", "Concern", "Recommendation");
  const accepted = attachFinalizedInvoiceHeaders([ar()], [same, structuredClone(same)]);
  assert.equal(accepted.fatalIssues.length, 0);
  assert.equal(accepted.counts.duplicateEquivalent, 1);
  const rejected = attachFinalizedInvoiceHeaders([ar()], [same, header("100", "Different", "Recommendation")]);
  assert.deepEqual(rejected.fatalIssues, [{ code: "conflicting-finalsold-headers", legacyRoNo: "100" }]);
  assert.deepEqual(finalizedInvoiceHeaderValues(rejected.rows[0]), { customerComplaint: null, recommendation: null });
});

test("customer, vehicle, or sold-date disagreement blocks the RO join", () => {
  const result = attachFinalizedInvoiceHeaders([ar()], [header("100", "Concern", "Recommendation", { legacyCustno: "99" })]);
  assert.ok(result.fatalIssues.some((issue) => issue.code === "finalsold-custno-mismatch"));
  assert.deepEqual(finalizedInvoiceHeaderValues(result.rows[0]), { customerComplaint: null, recommendation: null });
});

test("projected Invoice receives text while financial, date, mileage, and AR values stay authoritative", () => {
  const attached = attachFinalizedInvoiceHeaders([ar()], [header("100", "Concern", "LINE ONE\r\nLINE TWO")]);
  const result = projectLegacyInvoicePaymentInputs({
    shopId: "11111111-1111-4111-8111-111111111111", importRunId: "run",
    rawFinal: [], rawLabor: [], rawAr: attached.rows,
    resolvedCustomers: [{ legacyCustno: "10", customerId: "customer" }],
  });
  assert.equal(result.fatalIssues.length, 0);
  assert.deepEqual(result.invoices[0], {
    id: result.invoices[0].id, shopId: "11111111-1111-4111-8111-111111111111", importRunId: "run",
    legacyRoNo: "100", customerId: "customer", vehicleId: null, vehicleRecoveryAction: null,
    invoiceDate: new Date("2026-08-15T00:00:00.000Z"), odometer: 12345,
    customerComplaint: "Concern", recommendation: "LINE ONE\r\nLINE TWO", total: "160.00", paidTotal: "10.00",
  });
  assert.equal(result.stagedArRows[0].rawData.TOTAL, "160");
  assert.equal(result.stagedArRows[0].rawData.BALANCE, "150");
});

test("staging, finalized projection, and Invoice persistence all use the reconciled server-side header", async () => {
  const [staging, transformer, cutover] = await Promise.all([
    readFile(new URL("./import-invoices.mjs", import.meta.url), "utf8"),
    readFile(new URL("./transform-invoices.mjs", import.meta.url), "utf8"),
    readFile(new URL("./legacy-cutover.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(staging, /attachFinalizedInvoiceHeaders/);
  assert.match(staging, /sourceRows\.set\("rawLegacyAr", attachedHeaders\.rows\.map/);
  assert.match(transformer, /customerComplaint: header\.customerComplaint/);
  assert.match(transformer, /recommendation: header\.recommendation/);
  assert.match(transformer, /"customer_complaint", "recommendation"/);
  assert.match(cutover, /loadLegacyFinalizedInvoiceHeaders/);
  assert.match(cutover, /arSource\.rows = attachedHeaders\.rows/);
});
