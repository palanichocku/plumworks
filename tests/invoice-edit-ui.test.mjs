import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, ui, actions, layout, repairOrderRows, invoiceDocument, invoiceEmail] = await Promise.all([
  read("src/app/(app)/invoices/[id]/edit/page.tsx"),
  read("src/components/invoice-edit-workspace.tsx"),
  read("src/app/(app)/invoices/lifecycle-actions.ts"),
  read("src/components/line-item-layout.tsx"),
  read("src/components/repair-order-line-items.tsx"),
  read("src/lib/invoice-document.ts"),
  read("src/lib/email/invoice-email.tsx"),
]);

test("Save is inside the concerns form and reuses only the details mutation", () => {
  const header = ui.slice(ui.indexOf("<header"), ui.indexOf("</header>") + 9);
  assert.doesNotMatch(header, /Save Invoice Details|type="submit"/);
  assert.match(ui, /detailsPending \? "Saving…" : "Save"/);
  assert.match(ui, /useActionState\(updateInvoiceDetailsWithState, initialState\)/);
  assert.match(actions, /updateInvoiceDetailsWithState[\s\S]*invoiceEditResult\(updateInvoiceDetails/);
  assert.match(ui, /detailsDirty = complaint !== savedDetails\.complaint \|\| recommendation !== savedDetails\.recommendation/);
  assert.match(ui, /disabled=\{\(!detailsDirty && detailsState\.status !== "error"\) \|\| detailsPending\}/);
  assert.doesNotMatch(ui.slice(ui.indexOf("const detailsDirty"), ui.indexOf("const rememberDetails")), /part|labor/i);
  const concerns = ui.slice(ui.indexOf('<form id="invoice-details-form"'), ui.indexOf('<section className="ro-line-card'));
  assert.match(concerns, /Customer Complaint[\s\S]*Service Recommendation[\s\S]*<button type="submit"[\s\S]*>\{detailsPending \? "Saving…" : "Save"\}<\/button>/);
  assert.doesNotMatch(concerns, /<form[\s\S]*<form/);
});

test("Cancel remains in the header and explicitly bypasses the line warning", () => {
  const header = ui.slice(ui.indexOf("<header"), ui.indexOf("</header>") + 9);
  assert.match(header, /<Link href=\{`\/invoices\/\$\{invoice\.id\}`\} data-discard-unsaved-lines="true"[\s\S]*>Cancel<\/Link>/);
  assert.match(header, /unloadBypassRef\.current = true/);
  assert.doesNotMatch(header, /formAction|action=|type="submit"[^>]*>Cancel/);
});

test("header explains that Parts and Labor edits use their row check icons", () => {
  assert.match(ui, /Use the check icon to save changes to individual Parts and Labor lines\./);
  assert.match(ui, /text-sm text-slate-600/);
  assert.equal((ui.match(/Use the check icon/g) ?? []).length, 1);
});

test("Part and Labor rows report meaningful dirty state and clear it after success", () => {
  assert.match(ui, /type DirtyReporter = \(key: string, dirty: boolean\) => void/);
  assert.match(ui, /description\.trim\(\) !== "" \|\| quantity !== "1" \|\| price\.trim\(\) !== ""/);
  assert.match(ui, /description\.trim\(\) !== "" \|\| hours\.trim\(\) !== "" \|\| rate\.trim\(\) !== ""/);
  assert.equal((ui.match(/reportDirty\(line\.id, dirty\)/g) ?? []).length, 2);
  assert.equal((ui.match(/reportDirty\("draft", dirty\)/g) ?? []).length, 2);
  assert.equal((ui.match(/return \(\) => reportDirty\([^,]+, false\)/g) ?? []).length, 4);
  assert.match(ui, /onSuccess=\{\(\) => setSaved/);
  assert.match(ui, /onSuccess=\{onReset\}/);
});

test("dirty lines protect internal links, browser navigation, and unload", () => {
  assert.match(ui, /window\.addEventListener\("beforeunload", beforeUnload\)/);
  assert.match(ui, /document\.addEventListener\("click", onClick, true\)/);
  assert.match(ui, /window\.addEventListener\("popstate", onPopState\)/);
  assert.match(ui, /anchor\.dataset\.discardUnsavedLines === "true"/);
  assert.match(ui, /event\.preventDefault\(\)[\s\S]*setPendingDestination\(destination\.href\)/);
  assert.match(ui, /role="dialog" aria-modal="true"[\s\S]*aria-describedby=\{descriptionId\}/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, />Keep editing<\/button>[\s\S]*>Discard changes and leave<\/button>/);
});

test("warning copy distinguishes Part, Labor, and combined changes", () => {
  assert.match(ui, /You have unsaved Part changes\./);
  assert.match(ui, /You have unsaved Labor changes\./);
  assert.match(ui, /You have unsaved Part and Labor changes\./);
  assert.match(ui, /Click the check mark to save changes to an existing Part, or the plus sign to add a new Part\./);
  assert.match(ui, /Click the check mark to save changes to existing Labor, or the plus sign to add new Labor\./);
});

test("Invoice Part rows use compact saved and draft icon actions", () => {
  const saved = ui.slice(ui.indexOf("function SavedPartRow"), ui.indexOf("function DraftPartRow"));
  const draft = ui.slice(ui.indexOf("function DraftPartRow"), ui.indexOf("function SavedLaborRow"));
  assert.match(saved, /updateInvoicePartWithState/);
  assert.match(saved, /disabled=\{!dirty\}/);
  assert.match(saved, /ariaLabel="Save invoice part" title="Save invoice part"/);
  assert.match(saved, /label="Delete invoice part" action=\{deleteInvoicePart\}/);
  assert.match(draft, /addInvoicePartWithState/);
  assert.match(draft, /ariaLabel="Add invoice part" title="Add invoice part"/);
  assert.match(draft, /<ClearLineItemButton label="Clear invoice part" onClear=\{onReset\}/);
  assert.match(draft, /onSuccess=\{onReset\}/);
  assert.match(saved + draft, /Number\(quantity\) \* Number\(price\)/);
  assert.doesNotMatch(saved + draft, />\s*(?:Save|Update|Delete|Add part)\s*</i);
});

test("Invoice Labor rows use compact saved and draft icon actions", () => {
  const saved = ui.slice(ui.indexOf("function SavedLaborRow"), ui.indexOf("function DraftLaborRow"));
  const draft = ui.slice(ui.indexOf("function DraftLaborRow"), ui.indexOf("export function InvoiceEditWorkspace"));
  assert.match(saved, /updateInvoiceLaborWithState/);
  assert.match(saved, /disabled=\{!dirty\}/);
  assert.match(saved, /ariaLabel="Save invoice labor" title="Save invoice labor"/);
  assert.match(saved, /label="Delete invoice labor" action=\{deleteInvoiceLabor\}/);
  assert.match(draft, /addInvoiceLaborWithState/);
  assert.match(draft, /ariaLabel="Add invoice labor" title="Add invoice labor"/);
  assert.match(draft, /<ClearLineItemButton label="Clear invoice labor" onClear=\{onReset\}/);
  assert.match(draft, /onSuccess=\{onReset\}/);
  assert.match(saved + draft, /Number\(hours\) \* Number\(rate\)/);
  assert.doesNotMatch(saved + draft, />\s*(?:Save|Update|Delete|Add labor)\s*</i);
});

test("Clear stays local while saved trash uses existing server actions", () => {
  assert.match(layout, /function ClearLineItemButton[\s\S]*type="button"[\s\S]*onClick=\{onClear\}/);
  assert.doesNotMatch(layout.slice(layout.indexOf("function ClearLineItemButton")), /deleteInvoice/);
  assert.match(ui, /function DeleteButton[\s\S]*formAction=\{action\}/);
  assert.match(actions, /deleteInvoicePart[\s\S]*invoicePart\.deleteMany/);
  assert.match(actions, /deleteInvoiceLabor[\s\S]*invoiceLabor\.deleteMany/);
});

test("Invoice and Repair Order import the exact shared responsive row presentation", () => {
  assert.match(layout, /baseLineItemRowClass = "grid min-w-0 items-end gap-3"/);
  assert.match(layout, /partLineItemRowClass = `\$\{baseLineItemRowClass\} ro-part-row`/);
  assert.match(layout, /laborLineItemRowClass = `\$\{baseLineItemRowClass\} ro-labor-row`/);
  assert.match(layout, /function LineItemAmountActions[\s\S]*flex min-w-48 items-end justify-between[\s\S]*shrink-0/);
  assert.match(ui, /from "@\/components\/line-item-layout"/);
  assert.match(repairOrderRows, /from "@\/components\/line-item-layout"/);
  assert.doesNotMatch(ui, /\blineItemRowClass\b/);
  assert.doesNotMatch(ui.slice(ui.indexOf("function InvoiceActionForm"), ui.indexOf("function DeleteButton")), /partLineItemRowClass|laborLineItemRowClass/);
  assert.equal((ui.match(/rowClassName=\{partLineItemRowClass\}/g) ?? []).length, 2);
  assert.equal((ui.match(/rowClassName=\{laborLineItemRowClass\}/g) ?? []).length, 2);
  const partRows = ui.slice(ui.indexOf("function SavedPartRow"), ui.indexOf("function SavedLaborRow"));
  const laborRows = ui.slice(ui.indexOf("function SavedLaborRow"), ui.indexOf("export function InvoiceEditWorkspace"));
  assert.doesNotMatch(partRows, /laborLineItemRowClass/);
  assert.doesNotMatch(laborRows, /partLineItemRowClass/);
  assert.match(repairOrderRows, /className=\{`\$\{partLineItemRowClass\} rounded-lg/);
  assert.match(repairOrderRows, /className=\{`\$\{laborLineItemRowClass\} rounded-lg/);
  assert.equal((ui.match(/<LineItemAmountActions/g) ?? []).length, 4);
  assert.match(repairOrderRows, /<LineItemAmountActions/);
  assert.equal((ui.match(/className="ro-line-card/g) ?? []).length, 2);
  assert.match(ui, /aria-live="polite" className="col-span-full"/);
  assert.doesNotMatch(ui, /overflow-x-auto|overflow-x-scroll/);
});

test("lifecycle, payments, AR, calculations, and customer documents remain unchanged", () => {
  assert.match(page, /isEditableOpenInvoice\(invoice\)/);
  assert.match(actions, /status: "open", legacySourceTable: null/);
  assert.match(actions, /calculateEditableInvoiceTotals/);
  assert.match(actions, /payment\.aggregate/);
  assert.match(actions, /accountReceivable\.update/);
  assert.match(actions, /shopId: membership\.shopId/);
  assert.doesNotMatch(ui, /Vendor|Common Service/);
  assert.match(invoiceDocument, /getInvoiceDocumentForCurrentShop/);
  assert.match(invoiceEmail, /renderToBuffer\(<InvoiceDocumentPDF/);
});

test("Edit Invoice shows the complete saved financial position at the bottom", () => {
  for (const field of ["partsTotal", "laborTotal", "shopSuppliesAmount", "taxTotal", "total", "paidTotal"]) assert.match(page, new RegExp(`invoice\\.${field}`));
  assert.match(page, /accountsReceivable\[0\]\?\.balance \?\? invoiceBalance\(invoice\.total, invoice\.paidTotal\)/);
  assert.match(page, /partsTotal\.plus\(invoice\.laborTotal\)\.plus\(invoice\.shopSuppliesAmount\)/);
  const summary = ui.slice(ui.indexOf("function FinancialSummary"), ui.indexOf("export function InvoiceEditWorkspace"));
  assert.match(summary, /Totals and balance/);
  for (const label of ["Parts", "Labor", "Shop supplies", "Subtotal before tax", "Tax", "Total", "Paid", "Balance"]) assert.match(summary, new RegExp(`"${label}"`));
  assert.match(ui, /<FinancialSummary totals=\{totals\} updating=\{totalsUpdating\} \/>/);
});

test("unsaved line values use the authoritative server calculator for a live preview", () => {
  assert.match(actions, /export async function previewInvoiceEditTotals/);
  assert.match(actions, /calculateEditableInvoiceTotals\(\{/);
  assert.match(actions, /payment\.aggregate\(\{ where: \{ invoiceId, shopId: membership\.shopId \}/);
  assert.match(actions, /balance: invoiceBalance\(totals\.total, paid\)\.toFixed\(2\)/);
  assert.match(actions, /where: \{ id: invoiceId, shopId: membership\.shopId, status: "open", legacySourceTable: null \}/);
  assert.match(ui, /previewInvoiceEditTotals\(invoice\.id, \{ parts: Object\.values\(partLines\), labor: Object\.values\(laborLines\) \}\)/);
  assert.match(ui, /window\.setTimeout\(async \(\) =>/);
  assert.match(ui, /sequence === previewSequence\.current/);
  assert.doesNotMatch(ui, /paid\s*[+\-*\/]|balance\s*=/i);
});

test("Part, Labor, and draft edits independently feed preview state without persisting", () => {
  assert.equal((ui.match(/reportLine\(line\.id/g) ?? []).length, 2);
  assert.equal((ui.match(/reportLine\("draft"/g) ?? []).length, 4);
  assert.match(ui, /reportPartLine/);
  assert.match(ui, /reportLaborLine/);
  const preview = actions.slice(actions.indexOf("export async function previewInvoiceEditTotals"), actions.indexOf("async function refreshInvoice"));
  assert.doesNotMatch(preview, /\.(?:create|update|delete|upsert)\(/);
  assert.doesNotMatch(preview, /revalidatePath|redirect/);
});

test("Shop Supplies, tax, complimentary labor, and payment behavior match save recalculation", () => {
  const preview = actions.slice(actions.indexOf("export async function previewInvoiceEditTotals"), actions.indexOf("async function refreshInvoice"));
  for (const setting of ["shopSuppliesEnabledSnapshot", "shopSuppliesRateSnapshot", "shopSuppliesCapSnapshot", "shopSuppliesTaxableSnapshot", "defaultTaxRate", "partsTaxable", "laborTaxable"]) assert.match(preview, new RegExp(setting));
  assert.match(actions, /labor: \{ where: \{ complimentary: false \}/);
  assert.match(actions, /if \(balance\.lessThan\(0\)\)/);
  assert.match(actions, /accountReceivable\.update/);
});

test("an open Invoice created before Repair Order completion uses the same full edit summary", () => {
  assert.match(page, /isEditableOpenInvoice\(invoice\)/);
  assert.doesNotMatch(page + ui + actions, /repairOrder\.(?:status|closedAt)|Repair Order must be (?:complete|closed)/i);
  assert.match(page, /totals: \{[\s\S]*paid: invoice\.paidTotal\.toFixed\(2\), balance: balance\.toFixed\(2\)/);
  assert.match(ui, /data-discard-unsaved-lines="true"/);
  assert.doesNotMatch(ui, /(?:create|update|delete)Payment|paymentAction/);
});
