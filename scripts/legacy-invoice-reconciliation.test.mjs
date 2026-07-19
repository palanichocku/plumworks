import assert from "node:assert/strict";
import test from "node:test";
import { parseLegacyDate, selectLegacyInvoiceDate } from "./lib/legacy-invoice-reconciliation.mjs";

const row = (legacyRoNo, rawData) => ({ legacyRoNo, rawData });

for (const [ro, sold] of [["21499", "20260102"], ["21505", "20260106"], ["21523", "20260131"]]) {
  test(`${ro} uses its AR sale date without a FINAL row`, () => {
    const result = selectLegacyInvoiceDate({ arRows: [row(ro, { DATE_SOLD: sold, RO_DATE: sold })], laborRows: [row(ro, { DATE_SOLD: sold })] });
    assert.equal(result.date?.toISOString().slice(0, 10), `${sold.slice(0, 4)}-${sold.slice(4, 6)}-${sold.slice(6, 8)}`);
    assert.equal(result.source, "AR.DATE_SOLD");
  });
}

test("21496 prefers its January sale date to its December opening date", () => {
  const result = selectLegacyInvoiceDate({
    arRows: [row("21496", { DATE_SOLD: "20260102", RO_DATE: "20260102" })],
    finalRows: [row("21496", { DATE_SOLD: "20260102", RO_DATE: "20251229" })],
  });
  assert.equal(result.date?.toISOString().slice(0, 10), "2026-01-02");
});

test("21522 uses its February sale date instead of its January opening date", () => {
  const result = selectLegacyInvoiceDate({
    arRows: [row("21522", { DATE_SOLD: "20260202", RO_DATE: "20260202" })],
    finalRows: [row("21522", { DATE_SOLD: "20260202", RO_DATE: "20260130" })],
  });
  assert.equal(result.date?.toISOString().slice(0, 10), "2026-02-02");
});

test("date parsing rejects calendar rollover and malformed values", () => {
  assert.equal(parseLegacyDate("20260231"), null);
  assert.equal(parseLegacyDate("01/02/2026"), null);
});
