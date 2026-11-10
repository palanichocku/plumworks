import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/messaging/sms-reconsent-policy.ts", import.meta.url), "utf8");
// Exercise production policy code without Next.js/Prisma dependencies.
const javascript = source.slice(source.indexOf("export function canRestoreSmsConsent"))
  .replace("export function", "function")
  .replace("evidence: SmsRestorationEvidence, currentVersion: string", "evidence, currentVersion")
  .replace("): boolean {", ") {");
const canRestoreSmsConsent = new Function(javascript + "\nreturn canRestoreSmsConsent;")();

const at = (min) => new Date(Date.UTC(2026, 10, 9, 20, min));
const version = "2026-11-08-service-v1";
const base = {
  latestDecision: "OPT_OUT", suppressed: false,
  consentAt: at(1), consentVersion: version,
  stoppedAt: at(3), verifiedStartAt: at(4), declinedAt: null,
};
const allowed = (overrides = {}) => canRestoreSmsConsent({ ...base, ...overrides }, version);

test("original documented consent + STOP + verified START restores consent", () => {
  assert.equal(allowed(), true);
});
test("latest decline, including decline before STOP, blocks restoration", () => {
  assert.equal(allowed({ latestDecision: "DECLINED", declinedAt: at(2) }), false);
  assert.equal(allowed({ declinedAt: at(2) }), false);
});
test("never consented, changed number, and unknown history require new consent", () => {
  assert.equal(allowed({ consentAt: null }), false);
  assert.equal(allowed({ latestDecision: null }), false);
  assert.equal(allowed({ latestDecision: "OPT_IN" }), false); // normal consent handled separately
});
test("no verified START, out-of-order START, and active STOP never restore", () => {
  assert.equal(allowed({ verifiedStartAt: null }), false);
  assert.equal(allowed({ verifiedStartAt: at(2) }), false);
  assert.equal(allowed({ suppressed: true }), false);
});
test("new disclosure version requires fresh consent", () => {
  assert.equal(allowed({ consentVersion: "older-disclosure" }), false);
});
test("a later new OPT_IN supersedes an older decline", () => {
  assert.equal(allowed({ declinedAt: at(0) }), true);
});
test("date and sequence must be valid", () => {
  assert.equal(allowed({ stoppedAt: at(0) }), false);
  assert.equal(allowed({ consentAt: new Date(NaN) }), false);
});
