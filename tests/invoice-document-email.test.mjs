import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { invoiceEmailMessage, normalizeEmailRecipient, safeEmailHeader } from "../src/lib/email/invoice-email-core.ts";
import { sendResendSmtpMessage } from "../src/lib/email/smtp-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [model, html, pdf, printPage, css, action, emailUi, delivery, sharedDelivery, gmail, reportsEmail, schema, migration, detail, invoiceLoader, lifecycle, payment, conversion, vendorTest] = await Promise.all([
  read("src/lib/invoice-document.ts"), read("src/components/invoice-document-html.tsx"),
  read("src/components/pdf/invoice-document-pdf.tsx"), read("src/app/(documents)/invoices/[id]/print/page.tsx"),
  read("src/app/globals.css"), read("src/app/(app)/invoices/email-actions.tsx"),
  read("src/components/email-invoice-button.tsx"), read("src/lib/email/invoice-email.tsx"),
  read("src/lib/email/document-email.ts"),
  read("src/lib/email/gmail.ts"), read("src/lib/actions/email-reports.tsx"),
  read("prisma/schema.prisma"), read("prisma/migrations/20260724120000_add_invoice_document_settings/migration.sql"),
  read("src/app/(app)/invoices/[id]/page.tsx"), read("src/lib/data/invoices.ts"), read("src/app/(app)/invoices/lifecycle-actions.ts"),
  read("src/app/(app)/invoices/payment-actions.ts"), read("src/app/(app)/repair-orders/finalize-actions.ts"),
  read("tests/vendor-feature.test.mjs"),
]);

test("recipient validation normalizes valid addresses and rejects injection or malformed input", () => {
  assert.equal(normalizeEmailRecipient(" Customer@Example.COM "), "customer@example.com");
  assert.equal(normalizeEmailRecipient("not-an-email"), null);
  assert.equal(normalizeEmailRecipient("a@example.com\r\nBcc:bad@example.com"), null);
  assert.equal(safeEmailHeader("Shop\r\nBcc: bad"), "Shop Bcc: bad");
});

test("Invoice email content uses the shared trusted model", () => {
  const document = { invoiceNumber: "123", filename: "invoice-123.pdf", shop: { name: "Example Repair" } };
  const message = invoiceEmailMessage(document, "recipient@example.com");
  assert.equal(message.subject, "Invoice 123 from Example Repair");
  assert.equal(message.text, "Hello,\n\nAttached is your invoice 123 from Example Repair.\n\nThank you for your business.");
  assert.equal(message.to, "recipient@example.com");
});

test("document loader authenticates and scopes Invoice lookup to the membership shop", () => {
  assert.match(model, /getCurrentMembership\(\)/);
  assert.match(model, /if \(!user \|\| !membership\) return null/);
  assert.match(model, /where: \{ id: invoiceId, shopId \}/);
  assert.match(action, /getInvoiceDocumentForShop\(invoiceId, membership\.shopId\)/);
  assert.doesNotMatch(action, /formData\.get\("(?:shop|total|customer|vehicle|parts|labor|pdf|filename)/);
});

test("shared document maps authoritative values and customer/vehicle data without Vendor", () => {
  for (const field of ["partsTotal", "laborTotal", "subtotal", "discountAmount", "shopSuppliesAmount", "taxTotal", "total", "paidTotal"]) {
    assert.match(model, new RegExp(`${field}: true`));
  }
  assert.match(model, /accountsReceivable\[0\]\?\.balance \?\? invoice\.total\.minus\(invoice\.paidTotal\)/);
  assert.match(model, /displaySubtotalBeforeTax = invoice\.partsTotal\.plus\(invoice\.laborTotal\)\.plus\(invoice\.shopSuppliesAmount\)\.toDecimalPlaces\(2\)/);
  assert.match(model, /displaySubtotalBeforeTax: formatMoney\(displaySubtotalBeforeTax\)/);
  assert.match(model, /customerSnapshot/);
  assert.match(model, /vehicleSnapshot/);
  assert.match(model, /complaint: invoice\.customerComplaint/);
  assert.match(model, /recommendation: invoice\.recommendation/);
  assert.match(model, /discount: formatMoney\(invoice\.discountAmount\.negated\(\)\)/);
  assert.match(html, /model\.totals\.discount[\s\S]*<Detail label="Discount" value=\{model\.totals\.discount\}/);
  assert.match(pdf, /model\.totals\.discount[\s\S]*<Text>Discount<\/Text>/);
  assert.doesNotMatch(model + html + pdf, /vendorNameSnapshot|Vendor/);
  assert.doesNotMatch(model, /sublet|freight|towing/i);
});

test("customer-facing Invoice totals expose stored Shop Supplies in matching order", () => {
  const displaySubtotal = new Prisma.Decimal("50.00").plus("30.00").plus("2.40").toDecimalPlaces(2);
  assert.equal(displaySubtotal.toFixed(2), "82.40");
  assert.equal(displaySubtotal.plus("3.14").toFixed(2), "85.54");
  const detailTotals = detail.slice(detail.indexOf("Totals and balance"), detail.indexOf("Customer Concerns"));
  assert.match(detailTotals, /Parts[\s\S]*Labor[\s\S]*Shop supplies[\s\S]*Subtotal before tax[\s\S]*Tax[\s\S]*Total[\s\S]*Paid[\s\S]*Balance/);
  assert.match(detail, /formatMoney\(invoice\.shopSuppliesAmount\)/);
  assert.match(invoiceLoader, /shopSuppliesAmount: true/);
  assert.doesNotMatch(detailTotals, /formatMoney\(invoice\.subtotal\)/);
  for (const renderer of [html, pdf]) {
    assert.match(renderer, /Parts[\s\S]*Labor[\s\S]*Shop supplies[\s\S]*Subtotal before tax[\s\S]*Tax[\s\S]*Total/);
    assert.match(renderer, /model\.totals\.shopSupplies/);
    assert.match(renderer, /model\.totals\.displaySubtotalBeforeTax/);
  }
});

test("browser print and PDF share one model and contain matching business sections", () => {
  assert.match(printPage, /getInvoiceDocumentForCurrentShop/);
  assert.match(printPage, /<InvoiceDocumentHTML model=\{model\}/);
  assert.match(delivery, /<InvoiceDocumentPDF model=\{document\}/);
  for (const source of [html, pdf]) {
    assert.match(source, /CUSTOMER|Customer/);
    assert.match(source, /VEHICLE|Vehicle/);
    assert.match(source, /PARTS|Parts/);
    assert.match(source, /LABOR|Labor/);
    assert.match(source, /TOTALS|Totals/);
  }
  assert.match(css, /@page invoice-letter\s*\{[^}]*size:\s*Letter portrait;[^}]*margin:\s*0\.45in;/s);
  assert.match(css, /invoice-document table thead[\s\S]*display:\s*table-header-group/);
  assert.match(css, /invoice-document-bottom[\s\S]*break-inside:\s*auto/);
  assert.match(css, /invoice-document-totals[\s\S]*break-inside:\s*avoid/);
  assert.match(pdf, /<Page size="LETTER"/);
  assert.match(pdf, /wrap=\{false\}/);
});

test("Invoice Email dialog is accessible, prefillable, and blocks duplicate submission", () => {
  assert.match(detail, /defaultRecipient=\{normalizeEmailRecipient\(invoice\.customer\.email/);
  assert.match(emailUi, /role="dialog"/);
  assert.match(emailUi, /type="email"/);
  assert.match(emailUi, /disabled=\{pending\}/g);
  assert.match(emailUi, /pending \? "Sending…" : "Send Invoice"/);
  assert.match(action, /Invoice emailed successfully/);
  assert.match(emailUi, /aria-live="polite"/);
  assert.match(emailUi, /submittingRef\.current/);
  assert.match(emailUi, /if \(submittingRef\.current\) event\.preventDefault\(\)/);
  assert.equal((emailUi.match(/<form\b/g) ?? []).length, 1);
  assert.match(emailUi, /type="button"[^>]*[\s\S]*?>Cancel</);
});

test("successful Invoice email closes the dialog and shows temporary page-level feedback", () => {
  assert.match(emailUi, /if \(state\.status === "success"\) onSuccess\(state\.message\)/);
  assert.match(emailUi, /setOpen\(false\)[\s\S]*setSuccess/);
  assert.match(emailUi, /INVOICE_EMAIL_SUCCESS_DURATION_MS = 5_000/);
  assert.match(emailUi, /setTimeout\(\(\) => setSuccess\(null\), INVOICE_EMAIL_SUCCESS_DURATION_MS\)/);
  assert.match(emailUi, /buttonRef\.current\?\.focus\(\)/);
  assert.match(emailUi, /<p role="status" className="text-sm font-medium text-emerald-700">\{success\}<\/p>/);
  assert.doesNotMatch(emailUi, /state\.status === "success" \? <p/);
});

test("Invoice status, Email, and Print share one aligned action row without a status placeholder", () => {
  assert.match(detail, /status=\{open \? "Open" : "Closed"\}/);
  assert.match(detail, /printHref=\{`\/invoices\/\$\{invoice\.id\}\/print`\}/);
  const rowMarker = emailUi.indexOf("data-invoice-action-row");
  const actionRow = emailUi.slice(emailUi.lastIndexOf("<div", rowMarker), emailUi.indexOf("{success ?"));
  assert.match(actionRow, /items-center/);
  assert.match(actionRow, /\{status\}[\s\S]*Email[\s\S]*Print/);
  assert.doesNotMatch(actionRow, /success|role="status"|aria-live/);
  assert.match(emailUi, /<\/div>\s*\{success \? <div aria-live="polite"/);
  assert.doesNotMatch(emailUi.slice(0, emailUi.indexOf("function EmailInvoiceDialog")), /min-h-[0-9]/);
});

test("failed Invoice email remains inline in the dialog and preserves editable recipient state", () => {
  assert.match(emailUi, /state\.status === "error" && !errorDismissed \? state\.message \|\| fallbackError/);
  assert.match(emailUi, /Invoice could not be emailed\. Please try again\./);
  assert.match(emailUi, /value=\{recipient\}/);
  assert.match(emailUi, /onChange=\{\(event\) => \{ setRecipient\(event\.target\.value\); if \(error\) setErrorDismissed\(true\); \}\}/);
  assert.match(emailUi, /aria-live="assertive"/);
  assert.match(emailUi, /role="alert" className="text-sm font-medium text-red-700"/);
  assert.match(emailUi, /open \? <EmailInvoiceDialog/);
});

test("PDF is generated server-side and sent through the shared Reports email transport with a size guard", () => {
  assert.match(delivery, /renderToBuffer/);
  assert.match(delivery, /sendGmailMessage/);
  assert.match(gmail, /nodemailer\.createTransport\(/);
  assert.match(gmail, /MAX_EMAIL_ATTACHMENT_BYTES/);
  assert.match(gmail, /isEmailAttachmentSizeAllowed/);
  assert.match(reportsEmail, /sendGmailMessage/);
  assert.match(model, /filename: `invoice-\$\{invoiceNumber/);
  assert.match(delivery, /attachmentFilename: model\.filename/);
  assert.match(sharedDelivery, /contentType: "application\/pdf"/);
  assert.doesNotMatch(action + emailUi, /EMAIL_PASSWORD|EMAIL_USER|createTransport|sendMail/);
  assert.doesNotMatch(action, /prisma\.(?:create|update|upsert|delete)/);
});

test("complete Resend SMTP configuration sends the unchanged PDF attachment through an injected transport", async () => {
  const attachment = { filename: "invoice-123.pdf", content: Buffer.from("test PDF"), contentType: "application/pdf" };
  let sent;
  const result = await sendResendSmtpMessage(
    { to: "recipient@example.com", subject: "Invoice 123", text: "Attached", attachments: [attachment] },
    { apiKey: "test-api-key", fromAddress: "Car Doc <billing@example.com>", sendMail: async (message) => { sent = message; } },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.from, "Car Doc <billing@example.com>");
  assert.strictEqual(sent.attachments[0], attachment);
});

test("missing or failed Resend SMTP configuration is safe and never exposes secrets", async () => {
  const secret = "test-secret-that-must-not-appear";
  const diagnostics = [];
  let sendCount = 0;
  const message = { to: "recipient@example.com", subject: "Invoice 123", text: "Attached", attachments: [] };
  const missing = await sendResendSmtpMessage(message, {
    apiKey: " ", sendMail: async () => { sendCount += 1; }, logError: (entry) => diagnostics.push(entry),
  });
  const failed = await sendResendSmtpMessage(message, {
    apiKey: secret, sendMail: async () => { throw new Error(secret); }, logError: (entry) => diagnostics.push(entry),
  });
  assert.deepEqual(missing, { ok: false, message: "Email delivery is not configured." });
  assert.deepEqual(failed, { ok: false, message: "Email delivery failed. Please try again." });
  assert.equal(sendCount, 0);
  assert.match(diagnostics[0], /RESEND_API_KEY/);
  assert.doesNotMatch(JSON.stringify({ missing, failed, diagnostics }), new RegExp(secret));
});

test("additive settings migration is optional and nondestructive", () => {
  assert.match(schema, /repairFacilityRegistrationNumber\s+String\?/);
  assert.match(schema, /invoiceAuthorizationText\s+String\?/);
  assert.match(migration, /ALTER TABLE "shops"/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|TRUNCATE|UPDATE)\b/im);
  assert.doesNotMatch(migration, /ADD COLUMN[^,;]*NOT NULL/i);
});

test("printing and emailing do not alter lifecycle, payments, totals, conversion, or Vendor", () => {
  assert.doesNotMatch(model + printPage + action + delivery, /\b(?:invoice|payment|accountReceivable)\.(?:create|update|delete)\s*\(/);
  assert.match(lifecycle, /status: "open", legacySourceTable: null/);
  assert.match(payment, /payment\.create/);
  assert.match(conversion, /vendorNameSnapshot: line\.vendorNameSnapshot/);
  assert.match(vendorTest, /Vendor names are cleaned and normalized consistently/);
});
