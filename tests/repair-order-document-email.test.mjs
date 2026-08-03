import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { documentEmailMessage, normalizeEmailRecipient } from "../src/lib/email/document-email-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [detail, ui, action, model, pdf, delivery, sharedDelivery, invoiceDelivery, smtp, gmail] = await Promise.all([
  read("src/app/(app)/repair-orders/[id]/page.tsx"),
  read("src/components/email-repair-order-button.tsx"),
  read("src/app/(app)/repair-orders/email-actions.tsx"),
  read("src/lib/repair-order-document.ts"),
  read("src/components/pdf/repair-order-document-pdf.tsx"),
  read("src/lib/email/repair-order-email.tsx"),
  read("src/lib/email/document-email.ts"),
  read("src/lib/email/invoice-email.tsx"),
  read("src/lib/email/smtp-core.ts"),
  read("src/lib/email/gmail.ts"),
]);

test("Repair Order detail exposes an aligned Status, Email, Print action row", () => {
  assert.match(detail, /<EmailRepairOrderButton/);
  assert.match(detail, /defaultRecipient=\{normalizeEmailRecipient\(order\.customer\.email \?\? ""\) \?\? ""\}/);
  assert.match(detail, /printHref=\{`\/repair-orders\/\$\{order\.id\}\/print`\}/);
  const marker = ui.indexOf("data-repair-order-action-row");
  const row = ui.slice(ui.lastIndexOf("<div", marker), ui.indexOf("{success ?"));
  assert.match(row, /items-center/);
  assert.match(row, /\{status\}[\s\S]*Email[\s\S]*Print/);
  assert.doesNotMatch(row, /success|role="status"|aria-live/);
  assert.match(ui, /<\/div>\s*\{success \? <div aria-live="polite"/);
  assert.doesNotMatch(ui.slice(0, ui.indexOf("function EmailRepairOrderDialog")), /min-h-[0-9]/);
});

test("recipient is sourced only from the scoped Customer, remains editable, and may be blank", () => {
  assert.match(model, /customer: \{ select:[\s\S]*email: true/);
  assert.match(detail, /order\.customer\.email \?\? ""/);
  assert.match(ui, /useState\(defaultRecipient\)/);
  assert.match(ui, /value=\{recipient\}/);
  assert.match(ui, /onChange=\{\(event\) => \{ setRecipient\(event\.target\.value\)/);
  assert.equal(normalizeEmailRecipient(" Customer@Example.COM "), "customer@example.com");
  assert.equal(normalizeEmailRecipient(""), null);
  assert.equal(normalizeEmailRecipient("not-an-email"), null);
  assert.equal(normalizeEmailRecipient("a@example.com\r\nBcc:bad@example.com"), null);
});

test("Repair Order action authenticates and scopes the document before rendering or sending", () => {
  assert.match(action, /getCurrentMembership\(\)/);
  assert.match(action, /if \(!user \|\| !membership\)/);
  assert.match(action, /getRepairOrderDocumentForShop\(repairOrderId, membership\.shopId\)/);
  assert.match(model, /where: \{[\s\S]*id: repairOrderId,[\s\S]*shopId,[\s\S]*legacySourceTable: null/);
  assert.doesNotMatch(action, /formData\.get\("(?:shop|customer|vehicle|parts|labor|total|pdf|filename)/);
  assert.doesNotMatch(action + model, /prisma\.(?:create|update|upsert|delete)/);
});

test("Repair Order email content uses shared safe document conventions", () => {
  const message = documentEmailMessage({ documentType: "Repair Order", documentNumber: "42", shopName: "Example Repair", recipient: "recipient@example.com" });
  assert.deepEqual(message, {
    to: "recipient@example.com",
    subject: "Repair Order 42 from Example Repair",
    text: "Hello,\n\nAttached is your repair order 42 from Example Repair.\n\nThank you for your business.",
  });
  assert.match(delivery, /repairOrderEmailMessage/);
  assert.match(invoiceDelivery, /sendPdfDocumentEmail/);
  assert.match(delivery, /sendPdfDocumentEmail/);
});

test("Repair Order PDF uses its authoritative order, Customer, Vehicle, lines, notes, and stored estimates", () => {
  for (const field of ["repairOrderNumber", "openedAt", "closedAt", "customerComplaint", "recommendation", "partsTotal", "laborTotal", "shopSuppliesAmount", "taxTotal", "estimatedTotal"]) {
    assert.match(model, new RegExp(`${field}: true`));
  }
  assert.match(model, /customer: \{ select:/);
  assert.match(model, /vehicle: \{ select:/);
  assert.match(model, /parts: \{ orderBy:/);
  assert.match(model, /labor: \{ orderBy:/);
  for (const section of ["CUSTOMER", "VEHICLE", "PARTS", "LABOR \/ SERVICES", "ESTIMATE SUMMARY"]) assert.match(pdf, new RegExp(section));
  assert.match(pdf, /model\.complaint/);
  assert.match(pdf, /model\.recommendation/);
  assert.match(pdf, /ESTIMATE ONLY — NOT A FINALIZED INVOICE/);
  assert.doesNotMatch(pdf, /Amount paid|Balance due|Payment/);
});

test("Repair Order delivery attaches the rendered PDF with its number and shared size guard", () => {
  assert.match(delivery, /renderToBuffer\(<RepairOrderDocumentPDF model=\{document\} \/>\)/);
  assert.match(model, /filename: `repair-order-\$\{safeNumber\}\.pdf`/);
  assert.match(sharedDelivery, /contentType: "application\/pdf"/);
  assert.match(sharedDelivery, /attachmentFilename/);
  assert.match(smtp, /MAX_EMAIL_ATTACHMENT_BYTES = 18 \* 1024 \* 1024/);
  assert.match(gmail, /sendResendSmtpMessage/);
  assert.equal((gmail.match(/nodemailer\.createTransport\(/g) ?? []).length, 1);
  assert.doesNotMatch(delivery + action, /createTransport|smtp\.gmail|EMAIL_PASSWORD|EMAIL_USER/);
});

test("Repair Order dialog prevents duplicates and preserves accessible pending, success, and failure behavior", () => {
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-labelledby=\{titleId\}/);
  assert.match(ui, /aria-describedby=\{error \? errorId : undefined\}/);
  assert.match(ui, /disabled=\{pending\}/g);
  assert.match(ui, /pending \? "Sending…" : "Send Repair Order"/);
  assert.match(ui, /submittingRef\.current/);
  assert.match(ui, /if \(submittingRef\.current\) event\.preventDefault\(\)/);
  assert.match(ui, /if \(state\.status === "success"\) onSuccess\(state\.message\)/);
  assert.match(ui, /setOpen\(false\)[\s\S]*setSuccess/);
  assert.match(ui, /buttonRef\.current\?\.focus\(\)/);
  assert.match(ui, /REPAIR_ORDER_EMAIL_SUCCESS_DURATION_MS = 5_000/);
  assert.match(ui, /setTimeout\(\(\) => setSuccess\(null\), REPAIR_ORDER_EMAIL_SUCCESS_DURATION_MS\)/);
  assert.match(ui, /state\.status === "error" && !errorDismissed \? state\.message \|\| fallbackError/);
  assert.match(ui, /Repair Order could not be emailed\. Please try again\./);
  assert.match(ui, /role="alert" className="text-sm font-medium text-red-700"/);
  assert.match(ui, /if \(!pending\) onClose\(\)/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /open \? <EmailRepairOrderDialog/);
});

test("Repair Order action returns safe expected messages", () => {
  assert.match(action, /Enter a valid recipient email address\./);
  assert.match(action, /Repair Order not found for this shop\./);
  assert.match(action, /Repair Order emailed successfully\./);
  assert.doesNotMatch(action + delivery, /console\.|recipient@example|RESEND_API_KEY|process\.env/);
});
