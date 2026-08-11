import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [route, html, pdf, model, email, css, invoiceRoute, invoiceHtml, invoicePdf] = await Promise.all([
  read("src/app/(app)/repair-orders/[id]/print/page.tsx"),
  read("src/components/repair-order-document-html.tsx"),
  read("src/components/pdf/repair-order-document-pdf.tsx"),
  read("src/lib/repair-order-document.ts"),
  read("src/lib/email/repair-order-email.tsx"),
  read("src/app/globals.css"),
  read("src/app/(documents)/invoices/[id]/print/page.tsx"),
  read("src/components/invoice-document-html.tsx"),
  read("src/components/pdf/invoice-document-pdf.tsx"),
]);

test("browser print, PDF, and email share the scoped Repair Order document projection", () => {
  assert.match(route, /getRepairOrderDocumentForCurrentShop/);
  assert.match(route, /<RepairOrderDocumentHTML model=\{model\}/);
  assert.match(email, /<RepairOrderDocumentPDF model=\{document\}/);
  assert.match(model, /getCurrentMembership/);
  assert.match(model, /getRepairOrderDocumentForShop\(repairOrderId, membership\.shopId\)/);
  assert.match(model, /id: repairOrderId,[\s\S]*shopId,[\s\S]*legacySourceTable: null/);
});

test("printer-friendly HTML uses the Invoice document design system without color fills", () => {
  assert.match(html, /invoice-document repair-order-document/);
  assert.match(route, /invoice-print-route repair-order-print-route/);
  assert.match(css, /\.invoice-document\s*\{[\s\S]*background:\s*white;[\s\S]*color:\s*black;/);
  assert.match(css, /@page invoice-letter[\s\S]*size:\s*Letter portrait/);
  assert.doesNotMatch(html, /bg-(?:brand|amber|slate-9)|gradient|shadow|text-brand/);
  const estimateStyles = css.slice(css.indexOf(".repair-order-estimate-notice"), css.indexOf("@media screen", css.indexOf(".repair-order-estimate-notice")));
  assert.doesNotMatch(estimateStyles, /background(?:-color)?:/);
  assert.match(css, /\.print-hidden\s*\{\s*display:\s*none !important/);
  assert.match(css, /invoice-document table thead[\s\S]*display:\s*table-header-group/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /invoice-document-bottom[\s\S]*break-inside:\s*auto/);
  assert.match(css, /invoice-document-totals[\s\S]*break-inside:\s*avoid/);
});

test("HTML and PDF contain matching customer-facing sections and stored totals", () => {
  for (const source of [html, pdf]) {
    for (const section of ["CUSTOMER|Customer", "VEHICLE|Vehicle", "PARTS|Parts", "LABOR|Labor", "COMPLIMENTARY|Complimentary", "ESTIMATE SUMMARY|Estimate Summary"]) assert.match(source, new RegExp(section));
    for (const field of ["parts", "labor", "subtotal", "shopSupplies", "tax", "estimatedTotal"]) assert.match(source, new RegExp(`model\\.totals\\.${field}`));
    assert.match(source, /No charge/);
  }
  for (const field of ["partsTotal", "laborTotal", "shopSuppliesAmount", "taxTotal", "estimatedTotal"]) assert.match(model, new RegExp(`${field}: true`));
});

test("customer documents exclude internal notes, Vendor, controls, and private metadata", () => {
  const customerFacing = model + html + pdf + email;
  assert.doesNotMatch(customerFacing, /customer\.notes|vehicle\.notes|staffOnly|vendorNameSnapshot|Vendor|archive|HistoricalDescription|leadAttribution|permission/i);
  assert.doesNotMatch(html + pdf, /button|sidebar|navigation|internal ID/i);
});

test("Invoice print, HTML, and PDF architecture remains unchanged", () => {
  assert.match(invoiceRoute, /<InvoiceDocumentHTML model=\{model\}/);
  assert.match(invoiceHtml, /className="invoice-document"/);
  assert.match(invoicePdf, /<Page size="LETTER"/);
});
