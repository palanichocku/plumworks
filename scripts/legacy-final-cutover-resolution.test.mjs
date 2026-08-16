import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFinalCutoverResolution,
  EXCLUDE_STRUCTURAL_SOURCE_ROW,
  FINAL_CUTOVER_RESOLUTION_TYPE,
  INCLUDE_SOURCE_ROW,
  RESOLUTION_SOURCE_FILES,
  RESOLVE_ACTIVE_RO,
  validateFinalCutoverResolution,
} from "./lib/legacy-final-cutover-resolution.mjs";
import { evidenceHash } from "./lib/legacy-snapshot-evidence.mjs";
import { projectFinalCutoverOpenOrders } from "./lib/legacy-open-order-projection.mjs";
import { finalizedCollisionEvidence } from "./lib/legacy-final-cutover-adjudication.mjs";

const shopId = "10000000-0000-4000-8000-000000000001";
const source = { fingerprint: "a".repeat(64), fingerprints: Object.fromEntries(RESOLUTION_SOURCE_FILES.map((file, i) => [file, String(i + 1).repeat(64)])) };
const snapshot = { manifest: { snapshotDate: "2026-08-15", zipSha256: "b".repeat(64) }, manifestFingerprint: "c".repeat(64) };
const part = (key, desc, customer = "C1") => ({ legacyRowKey:key, legacyRoNo:"21759", legacyCustno:customer, legacyCarno:"V1", rawData:{ RO_NO:"21759",CUSTNO:customer,CARNO:"V1",RO_DATE:"20260815",ODOMETER:"122381",DESC:desc,QTY:"1",PRICE:desc?"10":"0" } });
const labor = (ro, key, customer = "0") => ({ legacyRowKey:key, legacyRoNo:ro, legacyCustno:customer, legacyCarno:"V1", rawData:{ RO_NO:ro,CUSTNO:customer,CARNO:"V1",RO_DATE:null,LABOR_DONE:"Diagnosis",HOURS:"1",LABORRATE:"134" } });
const parts = [part("part:1","Pump"), part("part:blank","", "C1")];
const laborRows = [labor("21759","labor:1")];
const evidence = (row, table, disposition) => ({ sourceTable:table, stableRowKey:row.legacyRowKey, evidenceSha256:evidenceHash(row.rawData), deleted:false, oldCustomerLegacyId:row.legacyCustno, oldVehicleLegacyId:row.legacyCarno, oldRoDate:row.rawData.RO_DATE ?? null, oldMileage:row.rawData.ODOMETER ?? null, disposition });
function manifest() { return { formatVersion:1,artifactType:FINAL_CUTOVER_RESOLUTION_TYPE,shopId,snapshot:{snapshotDate:snapshot.manifest.snapshotDate,zipSha256:snapshot.manifest.zipSha256,snapshotManifestSha256:snapshot.manifestFingerprint,combinedSourceFingerprint:source.fingerprint,sourceHashes:{...source.fingerprints}},decisions:[{action:RESOLVE_ACTIVE_RO,roNumber:21759,resolved:{customerLegacyId:"C1",vehicleLegacyId:"V1",roDate:"2026-08-15",mileage:122381},expectedFinalizedCollision:finalizedCollisionEvidence("21759",{"FINAL.DBF":[],"laborfinal.DBF":[],"ar.DBF":[]}),sourceRows:[evidence(parts[0],"orders.DBF",INCLUDE_SOURCE_ROW),evidence(parts[1],"orders.DBF",EXCLUDE_STRUCTURAL_SOURCE_ROW),evidence(laborRows[0],"LABORorder.DBF",INCLUDE_SOURCE_ROW)],reason:"Exact reviewed row repair."}],approval:{approved:true,reviewedBy:"reviewer",reviewedAt:"2026-08-16T12:00:00Z",reason:"Reviewed."} }; }
function validate(overrides={}) { return validateFinalCutoverResolution({manifest:manifest(),manifestFingerprint:"d".repeat(64),shopId,source,snapshot,openRows:{partRows:parts,laborRows},...overrides}); }

test("exact reviewed active-RO resolution normalizes only bound rows and excludes only an exact structural row", () => {
  const plan=validate(); assert.deepEqual(plan.fatalIssues,[]);
  const applied=applyFinalCutoverResolution({partRows:parts,laborRows,resolutionPlan:plan});
  assert.deepEqual(applied.partRows.map((r)=>r.legacyRowKey),["part:1"]);
  assert.equal(applied.laborRows[0].legacyCustno,"C1");
  assert.equal(applied.laborRows[0].rawData.RO_DATE,"20260815");
  assert.equal(applied.laborRows[0].rawData.ODOMETER,"122381");
});

test("reviewed resolution operationalizes an exact repaired RO without heuristic behavior", () => {
  const result=projectFinalCutoverOpenOrders({partRows:parts,laborRows,customers:[{id:"customer",legacyCustno:"C1"}],vehicles:[{id:"vehicle",legacyCarno:"V1",customerId:"customer"}],finalizedInvoices:[],survivingRepairOrders:[],shopSettings:{defaultTaxRate:"0",partsTaxable:true,laborTaxable:false,shopSuppliesEnabled:false,shopSuppliesRate:"0",shopSuppliesCap:"0",shopSuppliesTaxable:false},currentNextRepairOrderNumber:21765,resolutionPlan:validate()});
  assert.deepEqual(result.fatalIssues,[]); assert.equal(result.orders.length,1); assert.equal(result.orders[0].parts.length,1); assert.equal(result.orders[0].labor.length,1); assert.equal(result.nextRepairOrderNumber,21765);
});

for (const [label,change,code] of [
  ["wrong shop",m=>{m.shopId="wrong"},"active-ro-resolution-shop-mismatch"],
  ["wrong ZIP",m=>{m.snapshot.zipSha256="e".repeat(64)},"active-ro-resolution-zip-mismatch"],
  ["wrong fingerprint",m=>{m.snapshot.combinedSourceFingerprint="e".repeat(64)},"active-ro-resolution-source-fingerprint-mismatch"],
  ["wrong DBF",m=>{m.snapshot.sourceHashes["orders.DBF"]="e".repeat(64)},"active-ro-resolution-source-file-mismatch"],
  ["unapproved",m=>{m.approval.approved=false},"unapproved-active-ro-resolution"],
  ["changed key",m=>{m.decisions[0].sourceRows[0].stableRowKey="changed"},"active-ro-resolution-row-key-mismatch"],
  ["changed hash",m=>{m.decisions[0].sourceRows[0].evidenceSha256="e".repeat(64)},"active-ro-resolution-row-evidence-mismatch"],
  ["changed reviewed old date",m=>{m.decisions[0].sourceRows[0].oldRoDate="20260813"},"active-ro-resolution-old-date-mismatch"],
  ["changed finalized collision",m=>{m.decisions[0].expectedFinalizedCollision.sourceRows["ar.DBF"]=["changed"]},"active-ro-resolution-finalized-collision-mismatch"],
]) test(`${label} fails closed`,()=>{const m=manifest();change(m);const result=validate({manifest:m});assert.ok(result.fatalIssues.some(i=>i.code===code));assert.equal(result.rowActions.size,0)});

test("missing, extra, or changed source rows invalidate the exact reviewed set",()=>{
  for(const changed of [{partRows:parts.slice(1),laborRows},{partRows:[...parts,{...parts[0],legacyRowKey:"extra"}],laborRows},{partRows:[{...parts[0],rawData:{...parts[0].rawData,DESC:"Changed"}},parts[1]],laborRows}]) assert.ok(validate({openRows:changed}).fatalIssues.length>0);
});

test("no generic Customer-zero, missing-date, or blank-row heuristic exists",()=>{
  const without=applyFinalCutoverResolution({partRows:parts,laborRows,resolutionPlan:null});
  assert.equal(without.partRows.length,2); assert.equal(without.laborRows[0].legacyCustno,"0"); assert.equal(without.laborRows[0].rawData.RO_DATE,null);
});
