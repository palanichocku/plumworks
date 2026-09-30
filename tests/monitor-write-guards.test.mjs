import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const access = { user: { id: "monitor" }, membership: { shopId: "shop-dev", role: "MONITOR" } };
const noWrite = new Proxy({}, { get: () => { throw new Error("Database write was reached"); } });
const form = new FormData();
form.set("id", "00000000-0000-4000-8000-000000000001");

test("MONITOR cannot invoke customer or vehicle lifecycle mutations", async () => {
  const actions = await load("src/app/(app)/customer-vehicle-lifecycle-actions.ts", {
    "next/cache": { revalidatePath() {} }, "next/navigation": { redirect() {} },
    "@/generated/prisma/client": { Prisma: {} },
    "@/lib/data/membership": { getCurrentMembership: async () => access },
    "@/lib/prisma": { prisma: noWrite },
  });
  for (const name of ["archiveCustomer", "restoreCustomer", "archiveVehicle", "restoreVehicle"]) {
    await assert.rejects(actions[name](form), /permission/);
  }
});

test("MONITOR cannot invoke customer-facing document email actions", async () => {
  let delivered = 0;
  const invoice = await load("src/app/(app)/invoices/email-actions.tsx", {
    "@/lib/data/membership": { getCurrentMembership: async () => access },
    "@/lib/invoice-document": { getInvoiceDocumentForShop: async () => { throw new Error("Document read was reached"); } },
    "@/lib/email/invoice-email": { deliverInvoiceEmail: async () => { delivered++; } },
    "@/lib/email/invoice-email-core": { normalizeEmailRecipient: () => "recipient@example.test" },
    "@/lib/permissions": { hasPermission: () => false },
  });
  const repairOrder = await load("src/app/(app)/repair-orders/email-actions.tsx", {
    "@/lib/data/membership": { getCurrentMembership: async () => access },
    "@/lib/repair-order-document": { getRepairOrderDocumentForShop: async () => { throw new Error("Document read was reached"); } },
    "@/lib/email/repair-order-email": { deliverRepairOrderEmail: async () => { delivered++; } },
    "@/lib/email/document-email-core": { normalizeEmailRecipient: () => "recipient@example.test" },
    "@/lib/permissions": { hasPermission: () => false },
  });
  const emailForm = new FormData();
  emailForm.set("recipient", "recipient@example.test");
  emailForm.set("invoiceId", "00000000-0000-4000-8000-000000000001");
  emailForm.set("repairOrderId", "00000000-0000-4000-8000-000000000001");
  assert.equal((await invoice.sendInvoiceEmailAction({}, emailForm)).status, "error");
  assert.equal((await repairOrder.sendRepairOrderEmailAction({}, emailForm)).status, "error");
  assert.equal(delivered, 0);
});

test("normal staff actions and invitation options exclude MONITOR", async () => {
  const actions = await readFile(new URL("../src/app/(app)/admin/staff/actions.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/(app)/admin/staff/page.tsx", import.meta.url), "utf8");
  assert.match(actions, /new Set<ShopMembershipRole>\(\["OWNER", "ADMIN", "STAFF"\]\)/);
  assert.match(actions, /target\.role === "MONITOR"/);
  assert.match(page, /member\.role === "MONITOR"/);
  assert.match(page, /<p[^>]*>MONITOR<\/p>/);
  assert.doesNotMatch(page.match(/const roleOptions = ([^;]+);/)?.[1] ?? "", /MONITOR/);
});

test("search and historical-description actions require permissions MONITOR lacks", async () => {
  const paths = [
    ["src/lib/data/search.ts", "view_search"],
    ["src/app/(app)/repair-orders/customer-search-actions.ts", "view_search"],
    ["src/app/(app)/repair-orders/description-history-actions.ts", "edit_draft_repair_order"],
  ];
  for (const [path, permission] of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`hasPermission\\(membership\\.role, "${permission}"\\)`));
  }
});
