import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [invoicePage, paymentAction] = await Promise.all([
  read("src/app/(app)/invoices/[id]/page.tsx"),
  read("src/app/(app)/invoices/payment-actions.ts"),
]);

test("payment amount defaults to the authoritative remaining balance with two decimals", () => {
  assert.match(invoicePage, /const paymentAmount = receivable\?\.balance\.toFixed\(2\) \?\? "0\.00"/);
  assert.match(invoicePage, /name="amount"[^>]*max=\{paymentAmount\}[^>]*step="0\.01"[^>]*defaultValue=\{paymentAmount\}/);
  assert.doesNotMatch(invoicePage, /defaultValue=\{invoice\.total/);
  assert.doesNotMatch(invoicePage, /Number\(receivable\?\.balance/);
});

test("amount remains an editable uncontrolled input across unrelated rerenders", () => {
  assert.match(invoicePage, /name="amount" type="number"/);
  assert.doesNotMatch(invoicePage, /name="amount"[^>]*(?:readOnly|disabled|value=)/);
  assert.doesNotMatch(invoicePage, /useEffect|setAmount|onChange=\{/);
});

test("partial payments use the revalidated remaining balance as the next default", () => {
  assert.match(paymentAction, /revalidatePath\(`\/invoices\/\$\{invoiceId\}`\)/);
  assert.match(invoicePage, /paymentAmount = receivable\?\.balance\.toFixed\(2\)/);
});

test("fully paid invoices do not offer zero-dollar payment entry", () => {
  assert.match(invoicePage, /Boolean\(receivable\?\.balance\.greaterThan\(0\)\)/);
  assert.match(invoicePage, /\{canRecordPayment \? \(/);
  assert.match(invoicePage, /min="0\.01"/);
});

test("server-side positive amount, precision, and overpayment validation remain intact", () => {
  assert.match(paymentAction, /\^\\d\+\(\\\.\\d\{1,2\}\)\?\$/);
  assert.match(paymentAction, /amount\.greaterThan\(0\)/);
  assert.match(paymentAction, /currentBalance = invoice\.total\.minus\(existingPaid\)\.toDecimalPlaces\(2\)/);
  assert.match(paymentAction, /amount\.greaterThan\(currentBalance\)/);
});
