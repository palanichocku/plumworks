import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { configurationEvidence, preservedConfigurationDifferences, verifyRepairOrderSequence } from "./lib/final-cutover-preserved-state.mjs";

const verifySequence = (beforeCounter, numbers, actualCounter, extras = []) => verifyRepairOrderSequence({
  beforeCounter,
  actualCounter,
  repairOrders: [...numbers.map((repairOrderNumber) => ({ repairOrderNumber, legacyRoNo: String(repairOrderNumber), legacySourceTable: null })), ...extras],
});

test("no imported Repair Orders preserves the original counter", () => {
  assert.deepEqual(verifySequence(20, [], 20), {
    pass: true, beforeValue: 20, highestOperationalRONumber: null, expectedValue: 20, actualValue: 20, issues: [],
  });
});

test("Repair Orders below the captured counter preserve the original counter", () => {
  assert.equal(verifySequence(30000, [21833], 30000).pass, true);
});

test("Repair Orders at or above the captured counter advance to maximum plus one", () => {
  assert.equal(verifySequence(21833, [21833], 21834).pass, true);
  assert.equal(verifySequence(21833, [21834], 21835).pass, true);
});

test("RO 21833 advances the next number to 21834", () => {
  assert.deepEqual(verifySequence(20, [21833], 21834), {
    pass: true, beforeValue: 20, highestOperationalRONumber: 21833, expectedValue: 21834, actualValue: 21834, issues: [],
  });
});

test("multiple operational Repair Orders advance above the maximum", () => {
  assert.equal(verifySequence(100, [21700, 21833, 22010], 22011).expectedValue, 22011);
  assert.equal(verifySequence(100, [21700, 21833, 22010], 22011).pass, true);
});

test("malformed RO identifiers fail closed", () => {
  const result = verifyRepairOrderSequence({ beforeCounter: 20, actualCounter: 21834, repairOrders: [
    { repairOrderNumber: 21833, legacyRoNo: "21X33", legacySourceTable: null },
  ] });
  assert.equal(result.pass, false);
  assert.ok(result.issues.includes("malformed-operational-legacy-ro-number"));
});

test("expected counter cannot collide with another existing Repair Order", () => {
  const result = verifyRepairOrderSequence({ beforeCounter: 20, actualCounter: 21834, repairOrders: [
    { repairOrderNumber: 21833, legacyRoNo: "21833", legacySourceTable: null },
    { repairOrderNumber: 21834, legacyRoNo: "historic-text-id", legacySourceTable: "legacy" },
  ] });
  assert.equal(result.pass, false);
  assert.ok(result.issues.includes("next-counter-collides-with-existing-repair-order"));
});

test("a counter above expected fails", () => {
  assert.ok(verifySequence(20, [21833], 21835).issues.includes("counter-above-expected"));
});

test("a counter below expected fails", () => {
  assert.ok(verifySequence(20, [21833], 21833).issues.includes("counter-below-expected"));
});

test("only the sequence counter is excluded from exact Shop configuration comparison", () => {
  const before = { shop: { name: "Shop", nextRepairOrderNumber: 20 }, settings: { enabled: true } };
  assert.deepEqual(preservedConfigurationDifferences(before, {
    shop: { name: "Shop", nextRepairOrderNumber: 21834 }, settings: { enabled: true },
  }), []);
  assert.deepEqual(preservedConfigurationDifferences(before, {
    shop: { name: "Renamed", nextRepairOrderNumber: 21834 }, settings: { enabled: true },
  }), ["shop"]);
  assert.deepEqual(preservedConfigurationDifferences(before, {
    shop: { name: "Shop", nextRepairOrderNumber: 21834 }, settings: { enabled: true }, unexpectedConfig: true,
  }), ["unexpectedConfig"]);
});

test("preserved configuration captures shop signature identity without copying signature bytes", () => {
  assert.deepEqual(configurationEvidence({
    signatureDefaults: {
      representative_name: "Shop Representative",
      signature_sha256: "sha256-value",
      updated_by: "user-id",
      signature_data: "must-not-be-copied",
      updated_at: new Date(),
    },
    securitySettings: null,
  }), {
    shopSignatureDefaults: {
      representative_name: "Shop Representative",
      signature_sha256: "sha256-value",
      updated_by: "user-id",
    },
    shopSecuritySettings: null,
  });
});

test("preserved configuration records MFA setting and missing-table-row state", () => {
  assert.deepEqual(configurationEvidence({
    signatureDefaults: null,
    securitySettings: { mfa_required: true, updated_at: new Date() },
  }), {
    shopSignatureDefaults: null,
    shopSecuritySettings: { mfa_required: true },
  });
});

test("fresh-slate deletes evidence tables but never signature defaults or MFA configuration", async () => {
  const source = await readFile(new URL("./final-cutover-fresh-slate.mjs", import.meta.url), "utf8");
  assert.match(source, /"signature_evidence"/);
  assert.match(source, /"authorization_events"/);
  assert.doesNotMatch(source, /shop_signature_defaults|shop_security_settings/);
});
