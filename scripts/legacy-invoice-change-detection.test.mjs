import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyPersistedRows,
  comparePersistedRows,
  writableClassifications,
} from "./lib/legacy-invoice-change-detection.mjs";

const invoice = (overrides = {}) => ({
  legacyRoNo: "100", customerId: "customer", vehicleId: null, status: "paid",
  invoiceDate: new Date("2026-01-02T00:00:00.000Z"), partsTotal: "10.00",
  laborTotal: "20.00", subtotal: "30.00", taxTotal: "1.00", total: "32.00",
  paidTotal: "32.00", shopSuppliesAmount: "1.00", shopSuppliesEnabledSnapshot: true,
  shopSuppliesRateSnapshot: "0.080000", shopSuppliesCapSnapshot: "20.00",
  shopSuppliesTaxableSnapshot: true, shopSuppliesEligibleLaborTotal: "20.00",
  shopSuppliesCalculatedAmount: "1.00", shopSuppliesWasOverridden: false,
  legacySourceTable: "ar.DBF", updatedAt: new Date(), ...overrides,
});

test("identical invoice is unchanged and ignores updatedAt", () => {
  assert.equal(comparePersistedRows("invoice", invoice(), invoice({ updatedAt: new Date(0) })).changed, false);
});
test("invoice financial, relationship, and date differences cause one categorized update", () => {
  for (const [field, value, reason] of [["taxTotal","2","financial"],["shopSuppliesAmount","2","financial"],["customerId","other","customer/vehicle relationship"],["invoiceDate",new Date("2026-01-03Z"),"invoice date"]]) {
    const classified=classifyPersistedRows({model:"invoice",proposedRows:[invoice({[field]:value})],existingRows:[invoice()],identity:r=>r.legacyRoNo});
    assert.equal(classified.updates.length,1); assert.ok(classified.updates[0].reasons.includes(reason));
  }
});
test("equivalent decimal and date representations do not cause false updates", () => {
  const proposed=invoice({partsTotal:"10",shopSuppliesRateSnapshot:"0.08",invoiceDate:"2026-01-02T00:00:00Z"});
  assert.equal(comparePersistedRows("invoice",proposed,invoice()).changed,false);
});

const part=(overrides={})=>({legacyLineKey:"p1",invoiceId:"i1",description:"Part",partNumber:"P",quantity:"1.00",unitPrice:"2.00",legacyRoNo:"100",legacySourceTable:"FINAL.DBF",...overrides});
const labor=(overrides={})=>({legacyLineKey:"l1",invoiceId:"i1",description:"Labor",hours:"1.00",hourlyRate:"80.00",legacyRoNo:"100",legacySourceTable:"laborfinal.DBF",...overrides});
const ar=(overrides={})=>({legacyRoNo:"100",invoiceId:"i1",customerId:"c1",balance:"0.00",status:"paid",legacySourceTable:"ar.DBF",...overrides});
test("part and labor rows distinguish unchanged from changed amounts",()=>{
  assert.equal(comparePersistedRows("invoicePart",part(),part()).changed,false);
  assert.equal(comparePersistedRows("invoicePart",part({unitPrice:"3"}),part()).changed,true);
  assert.equal(comparePersistedRows("invoiceLabor",labor(),labor()).changed,false);
  assert.equal(comparePersistedRows("invoiceLabor",labor({hourlyRate:"90"}),labor()).changed,true);
});
test("AR rows distinguish unchanged from balance and status changes",()=>{
  assert.equal(comparePersistedRows("accountReceivable",ar(),ar()).changed,false);
  const comparison=comparePersistedRows("accountReceivable",ar({balance:"5",status:"open"}),ar());
  assert.equal(comparison.changed,true); assert.deepEqual(comparison.reasons,["balance/status"]);
});
test("legacy charges distinguish unchanged values from persisted changes",()=>{
  const charge={amount:"4.00",sourceLabel:"TAX3",taxable:false,legacySourceTable:"ar.DBF"};
  assert.equal(comparePersistedRows("invoiceLegacyCharge",charge,{...charge,amount:"4"}).changed,false);
  assert.equal(comparePersistedRows("invoiceLegacyCharge",{...charge,taxable:true},charge).changed,true);
});
test("writer input excludes unchanged rows and a mixed batch writes only inserts and changes",()=>{
  const classification=classifyPersistedRows({model:"invoicePart",proposedRows:[part(),part({legacyLineKey:"p2"}),part({legacyLineKey:"p3",unitPrice:"4"})],existingRows:[part(),part({legacyLineKey:"p3"})],identity:r=>r.legacyLineKey});
  assert.equal(classification.unchanged.length,1); assert.equal(classification.inserts.length,1); assert.equal(classification.updates.length,1);
  assert.deepEqual(writableClassifications(classification).map(r=>r.proposed.legacyLineKey),["p2","p3"]);
});
test("transformer transaction batches consume only writable classifications",async()=>{
  const source=await readFile(new URL("./transform-invoices.mjs",import.meta.url),"utf8");
  for(const classification of ["invoiceClassification","partClassification","laborClassification","arClassification"]) {
    assert.match(source,new RegExp(`chunks\\(writableClassifications\\(${classification}\\)\\)`));
  }
  assert.doesNotMatch(source,/chunks\((keyedParts|keyedLabor|validAr|\[\.\.\.validInvoices\])\)/);
});
