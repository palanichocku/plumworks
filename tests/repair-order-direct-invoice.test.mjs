import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, workspace, action, saveActions, lifecycle] = await Promise.all([
  read("src/app/(app)/repair-orders/[id]/page.tsx"),
  read("src/components/repair-order-concerns-form.tsx"),
  read("src/app/(app)/repair-orders/finalize-actions.ts"),
  read("src/app/(app)/repair-orders/actions.ts"),
  read("src/lib/invoice-lifecycle.ts"),
]);

test("Create Invoice submits directly with a pending-safe button and no confirmation link", () => {
  assert.match(workspace, /useActionState\(createInvoiceFromRepairOrder, initialCreateState\)/);
  assert.match(workspace, /<form action=\{createAction\}>/);
  assert.match(workspace, /name="repairOrderId" value=\{repairOrderId\}/);
  assert.match(workspace, /<button type="submit" disabled=\{dirty \|\| pending \|\| creating \|\| state\.status === "error"\}/);
  assert.match(workspace, /creating \? "Creating…" : "Create Invoice"/);
  assert.doesNotMatch(page + workspace, /createInvoiceHref|\/create-invoice/);
  assert.doesNotMatch(workspace, /confirmTitle|ConfirmDialog/);
});

test("direct creation preserves transaction, tenant, permission, lifecycle, and idempotency protections", () => {
  assert.match(action, /requirePermission\("finalize_repair_order"\)/);
  assert.match(action, /shop_id = \$\{membership\.shopId\}::uuid/);
  assert.match(action, /where: \{ repairOrderId, shopId: membership\.shopId \}/);
  assert.match(action, /legacySourceTable: null/);
  assert.match(action, /status: \{ in: \["draft", "open"\] \}/);
  assert.match(action, /FOR UPDATE/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.match(action, /if \(existingInvoice\) return existingInvoice/);
  assert.match(action, /redirect\(`\/invoices\/\$\{invoice\.id\}`\)/);
  assert.match(action, /vendorNameSnapshot: line\.vendorNameSnapshot/);
  assert.match(action, /calculateEditableInvoiceTotals/);
});

test("failure is safely inline and the transaction remains the only write boundary", () => {
  assert.match(action, /catch \{/);
  assert.match(action, /status: "error", message: "The Invoice could not be created/);
  assert.match(workspace, /role="alert" aria-live="assertive"/);
  assert.equal((action.match(/prisma\.\$transaction/g) ?? []).length, 1);
});

test("unsaved concerns must use the existing Save path before Invoice creation", () => {
  assert.match(workspace, /const \[dirty, setDirty\] = useState\(false\)/);
  assert.match(workspace, /disabled=\{dirty \|\| pending \|\| creating \|\| state\.status === "error"\}/);
  assert.match(workspace, /onSubmit=\{\(\) => setDirty\(false\)\}/);
  assert.match(workspace, /Save Repair Order changes before creating the Invoice/);
  assert.match(workspace, /form="repair-order-save-form"/);
  assert.match(saveActions, /updateRepairOrderConcerns/);
  assert.match(workspace, />Cancel<\/Link>/);
});

test("the old confirmation GET route is removed and cannot create an Invoice", async () => {
  await assert.rejects(access(new URL("../src/app/(app)/repair-orders/[id]/create-invoice/page.tsx", import.meta.url)));
  assert.doesNotMatch(page, /create-invoice/);
});

test("financial calculations remain delegated to the existing authoritative helper", () => {
  assert.match(action, /calculateEditableInvoiceTotals\(\{/);
  assert.match(lifecycle, /calculateShopSupplies/);
  assert.doesNotMatch(workspace, /partsTotal|laborTotal|taxTotal|estimatedTotal/);
});
