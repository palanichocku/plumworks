import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { invoiceEmailMessage, normalizeEmailRecipient, safeEmailHeader } from "../src/lib/email/invoice-email-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [model, html, pdf, printPage, css, action, emailUi, delivery, gmail, reportsEmail, schema, migration, detail, lifecycle, payment, conversion, vendorTest] = await Promise.all([
  read("src/lib/invoice-document.ts"), read("src/components/invoice-document-html.tsx"),
  read("src/components/pdf/invoice-document-pdf.tsx"), read("src/app/(documents)/invoices/[id]/print/page.tsx"),
  read("src/app/globals.css"), read("src/app/(app)/invoices/email-actions.tsx"),
  read("src/components/email-invoice-button.tsx"), read("src/lib/email/invoice-email.tsx"),
  read("src/lib/email/gmail.ts"), read("src/lib/actions/email-reports.tsx"),
  read("prisma/schema.prisma"), read("prisma/migrations/20260724120000_add_invoice_document_settings/migration.sql"),
  read("src/app/(app)/invoices/[id]/page.tsx"), read("src/app/(app)/invoices/lifecycle-actions.ts"),
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
  for (const field of ["partsTotal", "laborTotal", "subtotal", "shopSuppliesAmount", "taxTotal", "total", "paidTotal"]) {
    assert.match(model, new RegExp(`${field}: true`));
  }
  assert.match(model, /accountsReceivable\[0\]\?\.balance \?\? invoice\.total\.minus\(invoice\.paidTotal\)/);
  assert.match(model, /customerSnapshot/);
  assert.match(model, /vehicleSnapshot/);
  assert.match(model, /complaint: invoice\.customerComplaint/);
  assert.match(model, /recommendation: invoice\.recommendation/);
  assert.doesNotMatch(model + html + pdf, /vendorNameSnapshot|Vendor/);
  assert.doesNotMatch(model, /sublet|freight|towing|discount/i);
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
  assert.match(css, /invoice-document-bottom[\s\S]*break-inside:\s*avoid/);
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
  assert.equal((emailUi.match(/<form\b/g) ?? []).length, 1);
  assert.match(emailUi, /type="button"[^>]*[\s\S]*?>Cancel</);
});

test("PDF is generated server-side and sent through the Reports Gmail transport with a size guard", () => {
  assert.match(delivery, /renderToBuffer/);
  assert.match(delivery, /sendGmailMessage/);
  assert.match(gmail, /nodemailer\.createTransport\(\{ service: "gmail"/);
  assert.match(gmail, /MAX_EMAIL_ATTACHMENT_BYTES/);
  assert.match(gmail, /isEmailAttachmentSizeAllowed/);
  assert.match(reportsEmail, /sendGmailMessage/);
  assert.doesNotMatch(action + emailUi, /EMAIL_PASSWORD|EMAIL_USER|createTransport|sendMail/);
  assert.doesNotMatch(action, /prisma\.(?:create|update|upsert|delete)/);
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
