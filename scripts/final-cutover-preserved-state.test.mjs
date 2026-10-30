import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { configurationEvidence } from "./lib/final-cutover-preserved-state.mjs";

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
