import assert from "node:assert/strict";
import test from "node:test";
import {
  customerPhoneForStorage,
  formatExistingCustomerPhone,
  formatPhoneInput,
  isCompleteNorthAmericanPhone,
  normalizedNorthAmericanPhoneDigits,
} from "../src/lib/customer-phone.ts";

test("formats customer phone input progressively", () => {
  assert.equal(formatPhoneInput(""), "");
  assert.equal(formatPhoneInput("5"), "(5");
  assert.equal(formatPhoneInput("58"), "(58");
  assert.equal(formatPhoneInput("586"), "(586)");
  assert.equal(formatPhoneInput("5865"), "(586) 5");
  assert.equal(formatPhoneInput("586530"), "(586) 530");
  assert.equal(formatPhoneInput("5865300797"), "(586) 530-0797");
});

test("normalizes common pasted North American formats", () => {
  for (const value of [
    "5865300797",
    "586-530-0797",
    "(586)530-0797",
    "(586) 530-0797",
    "1-586-530-0797",
    "+1 586 530 0797",
  ]) {
    assert.equal(formatPhoneInput(value), "(586) 530-0797");
    assert.equal(customerPhoneForStorage(value), "(586) 530-0797");
  }
});

test("validation requires one complete national number", () => {
  assert.equal(customerPhoneForStorage(""), null);
  assert.equal(isCompleteNorthAmericanPhone("5865300797"), true);
  assert.equal(isCompleteNorthAmericanPhone("15865300797"), true);
  assert.equal(isCompleteNorthAmericanPhone("25865300797"), false);
  assert.equal(normalizedNorthAmericanPhoneDigits("158653007978"), null);
  assert.equal(customerPhoneForStorage("586-CAR-DOCS"), undefined);
});

test("input limits excess national digits and supports clearing", () => {
  assert.equal(formatPhoneInput("586530079799"), "(586) 530-0797");
  assert.equal(formatPhoneInput("+1 586 530 0797 99"), "(586) 530-0797");
  assert.equal(formatPhoneInput("(586) 530-0797".slice(0, 0)), "");
});

test("existing compatible values are formatted and legacy values are preserved", () => {
  assert.equal(formatExistingCustomerPhone("586-530-0797"), "(586) 530-0797");
  assert.equal(formatExistingCustomerPhone("1-586-530-0797"), "(586) 530-0797");
  assert.equal(formatExistingCustomerPhone("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(formatExistingCustomerPhone("586-CAR-DOCS ext 2"), "586-CAR-DOCS ext 2");
});
