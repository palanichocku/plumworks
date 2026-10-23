import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [authorizationPanel, repairOrderEmail, invoiceEmail, repairOrderEmailActions] = await Promise.all([
  read("src/components/repair-order-authorization-panel.tsx"),
  read("src/components/email-repair-order-button.tsx"),
  read("src/components/email-invoice-button.tsx"),
  read("src/app/(app)/repair-orders/email-actions.tsx"),
]);

test("estimate approval confirms the current recipient before sending", () => {
  assert.match(authorizationPanel, /getRepairOrderEmailRecipientAction/);
  assert.match(authorizationPanel, /setRecipient\(await getRepairOrderEmailRecipientAction\(repairOrderId\)\)/);
  assert.match(authorizationPanel, /Send estimate approval/);
  assert.match(authorizationPanel, /Send email to/);
  assert.match(authorizationPanel, /name="recipient"/);
  assert.match(authorizationPanel, /name="mode" value="authorization"/);
  assert.match(authorizationPanel, />Cancel<\/button>/);
  assert.match(authorizationPanel, /emailPending \? "Sending…" : "Send"/);
});

test("regular estimate email uses the same recipient confirmation wording", () => {
  assert.match(repairOrderEmail, /Email estimate/);
  assert.match(repairOrderEmail, /Send email to/);
  assert.match(repairOrderEmail, /name="recipient"/);
  assert.match(repairOrderEmail, />Cancel<\/button>/);
  assert.match(repairOrderEmail, /pending \? "Sending…" : "Send"/);
});

test("invoice email uses the same recipient confirmation wording", () => {
  assert.match(invoiceEmail, /Email Invoice/);
  assert.match(invoiceEmail, /Send email to/);
  assert.match(invoiceEmail, /name="recipient"/);
  assert.match(invoiceEmail, />Cancel<\/button>/);
  assert.match(invoiceEmail, /pending \? "Sending…" : "Send"/);
});

test("approval recipient lookup is shop-scoped and server-authorized", () => {
  assert.match(repairOrderEmailActions, /getRepairOrderEmailRecipientAction/);
  assert.match(repairOrderEmailActions, /getCurrentMembership\(\)/);
  assert.match(repairOrderEmailActions, /hasPermission\(membership\.role, "edit_draft_repair_order"\)/);
  assert.match(repairOrderEmailActions, /getRepairOrderDocumentForShop\(repairOrderId, membership\.shopId\)/);
  assert.match(repairOrderEmailActions, /normalizeEmailRecipient\(model\.customer\.email \?\? ""\)/);
});

test("repair order email submission honors the confirmed recipient", () => {
  assert.match(repairOrderEmailActions, /formData\.get\("recipient"\)/);
  assert.match(repairOrderEmailActions, /createRepairOrderEmailAuthorizationRequest\(\{ shopId: membership\.shopId, repairOrderId, recipientEmail: recipient \}\)/);
  assert.match(repairOrderEmailActions, /deliverRepairOrderEmail\(model, recipient/);
});
