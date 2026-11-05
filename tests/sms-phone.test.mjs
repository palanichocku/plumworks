import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUsSmsPhone, formatUsSmsPhone } from "../src/lib/messaging/phone.ts";

test("normalizes the phone format used by Car Doc", () => {
  for (const input of ["(586) 530-0797", "586-530-0797", "5865300797", "+15865300797", "1 (586) 530-0797"]) {
    assert.equal(normalizeUsSmsPhone(input), "+15865300797");
  }
  assert.equal(formatUsSmsPhone("+15865300797"), "(586) 530-0797");
});

test("rejects unsafe or unsupported phone formats", () => {
  for (const input of ["", "586530079", "58653007979", "1234567890", "+448665300797", "5865300797 ext 3", "+1+5865300797", "5865300797;foo", "0000000000"]) {
    assert.equal(normalizeUsSmsPhone(input), null, input);
  }
});
