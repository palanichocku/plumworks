import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [css, repairOrderHtml, invoiceHtml, repairOrderPdf, invoicePdf, repairOrderEmail, invoiceEmail] = await Promise.all([
  read("src/app/globals.css"),
  read("src/components/repair-order-document-html.tsx"),
  read("src/components/invoice-document-html.tsx"),
  read("src/components/pdf/repair-order-document-pdf.tsx"),
  read("src/components/pdf/invoice-document-pdf.tsx"),
  read("src/lib/email/repair-order-email.tsx"),
  read("src/lib/email/invoice-email.tsx"),
]);

const longDescription = "Engine-specific service line with a deliberately long description that must wrap cleanly without horizontal clipping in a Letter-width document";
const longRepairOrder = {
  parts: Array.from({ length: 30 }, (_, index) => ({ description: `RO part ${index + 1}: ${longDescription}` })),
  labor: Array.from({ length: 25 }, (_, index) => ({ description: `RO labor ${index + 1}: ${longDescription}` })),
  complimentaryServices: Array.from({ length: 4 }, (_, index) => ({ description: `Complimentary service ${index + 1}` })),
  complaint: longDescription,
  recommendation: longDescription,
  totals: { shopSupplies: "$12.34", tax: "$23.45", estimatedTotal: "$456.78" },
};
const longInvoice = {
  parts: Array.from({ length: 30 }, (_, index) => ({ description: `Invoice part ${index + 1}: ${longDescription}` })),
  labor: Array.from({ length: 25 }, (_, index) => ({ description: `Invoice labor ${index + 1}: ${longDescription}` })),
  complimentaryServices: Array.from({ length: 4 }, (_, index) => ({ description: `Complimentary service ${index + 1}` })),
  totals: { shopSupplies: "$12.34", tax: "$23.45", total: "$456.78", amountPaid: "$100.00", balanceDue: "$356.78" },
};

test("stress fixtures represent unbounded multi-page Repair Order and Invoice content", () => {
  assert.equal(longRepairOrder.parts.length, 30);
  assert.equal(longRepairOrder.labor.length, 25);
  assert.equal(longInvoice.parts.length, 30);
  assert.equal(longInvoice.labor.length, 25);
  assert.ok(longRepairOrder.parts.every(({ description }) => description.includes(longDescription)));
  assert.ok(longInvoice.labor.every(({ description }) => description.includes(longDescription)));
});

test("browser documents have no one-page height, clipping, or scale-to-fit constraint", () => {
  const printRule = css.slice(css.indexOf("@media print"), css.indexOf(".daily-sales-print"));
  assert.match(printRule, /\.invoice-document\s*\{[\s\S]*height:\s*auto;[\s\S]*max-height:\s*none;[\s\S]*overflow:\s*visible;[\s\S]*transform:\s*none;/);
  assert.doesNotMatch(printRule, /height:\s*11in|max-height:\s*11in|overflow:\s*(?:hidden|clip)|transform:\s*scale\(/);
  assert.match(printRule, /invoice-document-section,[\s\S]*invoice-document table,[\s\S]*invoice-document tbody,[\s\S]*invoice-document-bottom[\s\S]*break-inside:\s*auto/);
  assert.doesNotMatch(printRule, /invoice-document (?:td|th)[\s\S]{0,80}break-inside:\s*avoid/);
});

test("browser tables can span pages while rows and totals remain intact", () => {
  assert.match(css, /invoice-document table thead[\s\S]*display:\s*table-header-group/);
  assert.match(css, /\.invoice-document tr\s*\{[\s\S]*break-inside:\s*avoid;[\s\S]*page-break-inside:\s*avoid;/);
  assert.match(css, /\.invoice-document-totals,[\s\S]*break-inside:\s*avoid/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  for (const html of [repairOrderHtml, invoiceHtml]) {
    assert.match(html, /<thead>/);
    assert.match(html, /model\.parts\.map/);
    assert.match(html, /model\.labor\.map/);
    assert.doesNotMatch(html, /model\.(?:parts|labor)\.(?:slice|splice)\(/);
  }
});

test("React PDF pages and line collections wrap without making whole sections indivisible", () => {
  for (const pdf of [repairOrderPdf, invoicePdf]) {
    assert.match(pdf, /<Page size="LETTER" style=\{styles\.page\} wrap>/);
    assert.match(pdf, /model\.parts\.map/);
    assert.match(pdf, /model\.labor\.map/);
    assert.doesNotMatch(pdf, /model\.(?:parts|labor)\.(?:slice|splice)\(/);
    assert.doesNotMatch(pdf, /<View style=\{styles\.section\} wrap=\{false\}>/);
    assert.doesNotMatch(pdf, /<View style=\{styles\.bottom\} wrap=\{false\}>/);
    assert.match(pdf, /<View style=\{styles\.totals\} wrap=\{false\}>/);
    assert.match(pdf, /style=\{styles\.tableRow\} wrap=\{false\}/);
    assert.match(pdf, /<View fixed style=\{styles\.tableHeader\}>/);
  }
});

test("email attachments continue to use the same generated PDFs", () => {
  assert.match(repairOrderEmail, /renderToBuffer\(<RepairOrderDocumentPDF model=\{document\} \/>\)/);
  assert.match(invoiceEmail, /renderToBuffer\(<InvoiceDocumentPDF model=\{document\} \/>\)/);
});

test("pagination changes preserve totals, complimentary services, and customer-facing exclusions", () => {
  for (const source of [repairOrderHtml, repairOrderPdf]) {
    for (const field of ["parts", "labor", "shopSupplies", "tax", "estimatedTotal"]) assert.match(source, new RegExp(`model\\.totals\\.${field}`));
    assert.match(source, /No charge/);
  }
  for (const source of [invoiceHtml, invoicePdf]) {
    for (const field of ["parts", "labor", "shopSupplies", "tax", "total", "amountPaid", "balanceDue"]) assert.match(source, new RegExp(`model\\.totals\\.${field}`));
    assert.match(source, /No charge/);
  }
  assert.doesNotMatch(repairOrderHtml + repairOrderPdf + invoiceHtml + invoicePdf, /vendorNameSnapshot|customer\.notes|vehicle\.notes|staffOnly/i);
});
