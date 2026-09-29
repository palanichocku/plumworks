import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as audit from "../src/lib/audit.ts";
import * as voidLogic from "../src/lib/repair-order-void.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, migration, page, list, listLoader, searchLoader, documentLoader, documentHtml, documentPdf, emailButton, emailAction, permissionsText, matrixText, voidButton, detail] = await Promise.all([
  read("prisma/schema.prisma"),
  read("prisma/migrations/20260929120000_add_repair_order_void_metadata/migration.sql"),
  read("src/app/(app)/repair-orders/[id]/page.tsx"),
  read("src/app/(app)/repair-orders/page.tsx"),
  read("src/lib/data/open-orders.ts"),
  read("src/lib/data/search.ts"),
  read("src/lib/repair-order-document.ts"),
  read("src/components/repair-order-document-html.tsx"),
  read("src/components/pdf/repair-order-document-pdf.tsx"),
  read("src/components/email-repair-order-button.tsx"),
  read("src/app/(app)/repair-orders/email-actions.tsx"),
  read("src/lib/permissions.ts"),
  read("src/lib/permission-matrix.json"),
  read("src/components/void-repair-order-button.tsx"),
  read("src/lib/data/repair-orders.ts"),
]);

const shopId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const baseOrder = (overrides = {}) => ({
  id: orderId, shopId, repairOrderNumber: 21827, status: "draft", legacySourceTable: null,
  voidedAt: null, voidedByUserId: null, voidReason: null, voidNote: null,
  customerId: "customer-1", vehicleId: "vehicle-1", odometer: 84521,
  customerComplaint: "Synthetic brake concern", recommendation: "Inspect front brakes",
  parts: [{ id: "part-1", description: "Synthetic brake pad", quantity: "1", unitPrice: "120.00" }],
  labor: [{ id: "labor-1", description: "Synthetic brake service", hours: "1.5", hourlyRate: "100.00" }],
  partsTotal: "120.00", laborTotal: "150.00", taxTotal: "8.10", estimatedTotal: "278.10",
  ...overrides,
});
const form = (values = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ repairOrderId: orderId, reason: "CREATED_IN_ERROR", note: "", ...values })) data.set(key, value);
  return data;
};

async function loadAction(dependencies) {
  const source = await read("src/app/(app)/repair-orders/void-actions.ts");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(name in dependencies, `unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports.voidRepairOrder;
}

async function fixture({ order = baseOrder(), invoices = [], role = "OWNER", auditLoggingEnabled = true } = {}) {
  const state = { order: structuredClone(order), invoices: structuredClone(invoices), audits: [] };
  const calls = { locks: [], isolation: [], updates: [], permissions: [], revalidated: [] };
  const matrix = JSON.parse(matrixText);
  const tx = {
    $queryRaw: async (strings) => { calls.locks.push(strings.join("?")); return []; },
    repairOrder: {
      findFirst: async ({ where }) => where.id === state.order.id && where.shopId === state.order.shopId ? state.order : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, state.order.id);
        calls.updates.push(structuredClone(data));
        Object.assign(state.order, data);
        return state.order;
      },
    },
    invoice: { findFirst: async ({ where }) => state.invoices.find((invoice) => invoice.repairOrderId === where.repairOrderId && invoice.shopId === where.shopId) ?? null },
    auditLog: { create: async ({ data }) => { state.audits.push(data); return data; } },
  };
  const prisma = { $transaction: async (callback, options) => { calls.isolation.push(options?.isolationLevel); return callback(tx); } };
  const user = { id: userId, email: "owner@example.test" };
  const membership = { shopId, role, shop: { auditLoggingEnabled } };
  const requirePermission = async (permission) => {
    calls.permissions.push(permission);
    if (!matrix[role].includes(permission)) throw new Error("You do not have permission to perform this action.");
    return { user, membership };
  };
  const action = await loadAction({
    "next/cache": { revalidatePath: (path) => calls.revalidated.push(path) },
    "@/lib/audit": audit,
    "@/lib/prisma": { prisma },
    "@/lib/permissions": { requirePermission },
    "@/lib/repair-order-void": voidLogic,
  });
  return { action, state, calls };
}

test("Draft Repair Order can be voided without deleting the row", async () => {
  const f = await fixture();
  const result = await f.action({ status: "idle" }, form());
  assert.equal(result.status, "success");
  assert.equal(f.state.order.status, "void");
  assert.equal(f.state.order.id, orderId);
});

test("Open Repair Order can be voided", async () => {
  const f = await fixture({ order: baseOrder({ status: "open" }) });
  assert.equal((await f.action({ status: "idle" }, form({ reason: "DUPLICATE" }))).status, "success");
  assert.equal(f.state.order.status, "void");
});

test("void preserves the assigned RO number, Parts, Labor, mileage, concerns, and totals", async () => {
  const f = await fixture();
  await f.action({ status: "idle" }, form());
  assert.equal(f.state.order.repairOrderNumber, 21827);
  assert.equal(f.state.order.odometer, 84521);
  assert.deepEqual(f.state.order.parts, baseOrder().parts);
  assert.deepEqual(f.state.order.labor, baseOrder().labor);
  assert.deepEqual([f.state.order.partsTotal, f.state.order.laborTotal, f.state.order.taxTotal, f.state.order.estimatedTotal], ["120.00", "150.00", "8.10", "278.10"]);
  assert.equal(f.state.order.customerComplaint, "Synthetic brake concern");
  assert.equal(f.state.order.recommendation, "Inspect front brakes");
});

test("void does not create or remove an Invoice", async () => {
  const existing = [{ id: "unrelated-invoice", repairOrderId: "another-ro", shopId }];
  const f = await fixture({ invoices: existing });
  await f.action({ status: "idle" }, form());
  assert.deepEqual(f.state.invoices, existing);
});

test("void writes durable actor and timestamp metadata with the selected reason", async () => {
  const f = await fixture();
  await f.action({ status: "idle" }, form());
  assert.equal(f.state.order.voidReason, "CREATED_IN_ERROR");
  assert.equal(f.state.order.voidedByUserId, userId);
  assert.ok(f.state.order.voidedAt instanceof Date);
});

test("an optional operational audit entry contains RO, reason, actor, and timestamp context", async () => {
  const f = await fixture();
  await f.action({ status: "idle" }, form());
  assert.equal(f.state.audits[0].action, "repair_order_voided");
  assert.equal(f.state.audits[0].metadata.repairOrderNumber, 21827);
  assert.equal(f.state.audits[0].metadata.reason, "CREATED_IN_ERROR");
  assert.equal(f.state.audits[0].metadata.voidedByUserId, userId);
  assert.ok(f.state.audits[0].metadata.voidedAt);
});

test("durable void metadata remains even when optional operational audit logging is disabled", async () => {
  const f = await fixture({ auditLoggingEnabled: false });
  await f.action({ status: "idle" }, form());
  assert.equal(f.state.audits.length, 0);
  assert.equal(f.state.order.status, "void");
  assert.ok(f.state.order.voidedAt instanceof Date);
});

test("canned reasons are accepted without an explanation and keep voidNote null", async () => {
  for (const reason of ["CREATED_IN_ERROR", "DUPLICATE", "WRONG_ASSIGNMENT"]) {
    const f = await fixture();
    assert.equal((await f.action({ status: "idle" }, form({ reason }))).status, "success");
    assert.equal(f.state.order.voidNote, null);
  }
});

test("Other requires an explanation after whitespace trimming", () => {
  assert.match(voidLogic.validateRepairOrderVoidInput(orderId, "OTHER", "  "), /at least 3 characters/);
  assert.match(voidLogic.validateRepairOrderVoidInput(orderId, "OTHER", " x "), /at least 3 characters/);
  assert.equal(voidLogic.validateRepairOrderVoidInput(orderId, "OTHER", " why "), null);
});

test("Other note is trimmed and stored on the Repair Order", async () => {
  const f = await fixture();
  assert.equal((await f.action({ status: "idle" }, form({ reason: "OTHER", note: "  Shop entered the wrong RO.  " }))).status, "success");
  assert.equal(f.state.order.voidNote, "Shop entered the wrong RO.");
});

test("only the four Repair Order specific reason codes are valid", async () => {
  assert.deepEqual(voidLogic.REPAIR_ORDER_VOID_REASON_OPTIONS.map(({ value }) => value), ["CREATED_IN_ERROR", "DUPLICATE", "WRONG_ASSIGNMENT", "OTHER"]);
  const f = await fixture();
  const result = await f.action({ status: "idle" }, form({ reason: "CUSTOMER_DECLINED" }));
  assert.equal(result.status, "error");
  assert.equal(f.calls.updates.length, 0);
});

test("invalid reason is rejected server-side before a transaction", async () => {
  const f = await fixture();
  assert.equal((await f.action({ status: "idle" }, form({ reason: "NOPE" }))).status, "error");
  assert.equal(f.calls.isolation.length, 0);
});

test("explanations longer than 500 characters are rejected server-side", async () => {
  const f = await fixture();
  const result = await f.action({ status: "idle" }, form({ reason: "OTHER", note: "x".repeat(501) }));
  assert.match(result.message, /500 characters/);
  assert.equal(f.calls.updates.length, 0);
});

test("invalid Repair Order identifiers are rejected server-side", async () => {
  assert.match(voidLogic.validateRepairOrderVoidInput("21827", "DUPLICATE", ""), /could not be identified/);
  const f = await fixture();
  assert.equal((await f.action({ status: "idle" }, form({ repairOrderId: "not-a-uuid" }))).status, "error");
  assert.equal(f.calls.isolation.length, 0);
});

test("already-voided Repair Orders cannot be voided again", async () => {
  const f = await fixture({ order: baseOrder({ status: "void", voidReason: "DUPLICATE" }) });
  assert.match((await f.action({ status: "idle" }, form())).message, /already been voided/);
  assert.equal(f.calls.updates.length, 0);
});

test("invoiced and finalized Repair Orders are not eligible", async () => {
  for (const status of ["invoiced", "finalized"]) {
    const f = await fixture({ order: baseOrder({ status }) });
    assert.equal((await f.action({ status: "idle" }, form())).status, "error");
    assert.equal(f.calls.updates.length, 0);
  }
});

test("a Repair Order with an Invoice cannot be voided even if its status is open", async () => {
  const f = await fixture({ order: baseOrder({ status: "open" }), invoices: [{ id: "invoice-1", repairOrderId: orderId, shopId }] });
  assert.match((await f.action({ status: "idle" }, form())).message, /with an Invoice/);
  assert.equal(f.calls.updates.length, 0);
});

test("imported Repair Orders cannot be voided", async () => {
  const f = await fixture({ order: baseOrder({ legacySourceTable: "orders/LABORorder" }) });
  assert.match((await f.action({ status: "idle" }, form())).message, /imported/);
  assert.equal(f.calls.updates.length, 0);
});

test("unnumbered Repair Orders cannot be voided", async () => {
  const f = await fixture({ order: baseOrder({ repairOrderNumber: null }) });
  assert.match((await f.action({ status: "idle" }, form())).message, /numbered/);
  assert.equal(f.calls.updates.length, 0);
});

test("wrong-Shop Repair Order IDs are not found or modified", async () => {
  const f = await fixture({ order: baseOrder({ shopId: "00000000-0000-4000-8000-000000000099" }) });
  assert.match((await f.action({ status: "idle" }, form())).message, /not found/);
  assert.equal(f.calls.updates.length, 0);
});

test("OWNER and ADMIN may void while STAFF is denied", async () => {
  for (const role of ["OWNER", "ADMIN"]) {
    const f = await fixture({ role });
    assert.equal((await f.action({ status: "idle" }, form())).status, "success");
    assert.deepEqual(f.calls.permissions, ["void_repair_order"]);
  }
  const staff = await fixture({ role: "STAFF" });
  await assert.rejects(staff.action({ status: "idle" }, form()), /permission/);
  assert.deepEqual(staff.calls.permissions, ["void_repair_order"]);
});

test("permission matrix replaces the old delete capability at the same role level", () => {
  const matrix = JSON.parse(matrixText);
  assert.match(permissionsText, /"void_repair_order"/);
  assert.ok(matrix.OWNER.includes("void_repair_order"));
  assert.ok(matrix.ADMIN.includes("void_repair_order"));
  assert.ok(!matrix.STAFF.includes("void_repair_order"));
  assert.doesNotMatch(permissionsText + matrixText, /delete_draft_repair_order/);
});

test("voiding takes the existing row lock and serializable transaction", async () => {
  const f = await fixture();
  await f.action({ status: "idle" }, form());
  assert.equal(f.calls.isolation[0], "Serializable");
  assert.match(f.calls.locks[0], /FROM repair_orders[\s\S]*FOR UPDATE/);
});

test("successful void revalidates list, detail, and search while keeping the same URL", async () => {
  const f = await fixture();
  const result = await f.action({ status: "idle" }, form());
  assert.deepEqual(f.calls.revalidated, ["/repair-orders", `/repair-orders/${orderId}`, "/search"]);
  assert.match(result.message, /RO #21827/);
});

test("voided ROs stay out of the active list but remain in global search", () => {
  assert.match(list, /VoidRepairOrderButton/);
  assert.match(voidButton, /reason === "OTHER" \? <label[\s\S]*?Please explain[\s\S]*?required minLength=\{3\} maxLength=\{500\}/);
  assert.match(listLoader, /operationalRepairOrderWhere\(membership\.shopId\)/);
  assert.match((voidLogic.repairOrderVoidEligibilityError(baseOrder({ status: "void", hasInvoice: false }))), /already been voided/);
  assert.match(searchLoader, /repairOrder\.findMany\(\{\s*where: \{\s*shopId,/);
  assert.doesNotMatch(searchLoader, /status:\s*\{[^}]*draft/);
  assert.match(searchLoader, /repairOrderNumber: numericRo/);
});

test("voided RO detail remains loadable, displays human reason, and disables editing", () => {
  assert.match(detail, /"finalized", "invoiced", "void"/);
  assert.match(page, /order\.status === "void"/);
  assert.match(page, /repairOrderVoidReasonLabel\(order\.voidReason\)/);
  assert.match(page, /This repair order was voided and is retained for audit history/);
  assert.match(page, /editable = order\.status === "draft" \|\| order\.status === "open"/);
  assert.match(page, /order\.status !== "void"[\s\S]*canEditInternalNotes/);
  assert.doesNotMatch(page, /WRONG_ASSIGNMENT/);
});

test("voided Repair Orders remain printable with a prominent audit banner and human reason", () => {
  assert.match(documentLoader, /status: \{ in: \["draft", "open", "finalized", "invoiced", "void"\] \}/);
  assert.match(documentLoader, /repairOrderVoidReasonLabel\(order\.voidReason\)/);
  assert.match(documentHtml, /VOID — RETAINED FOR AUDIT HISTORY/);
  assert.match(documentHtml, /model\.voidReasonLabel/);
  assert.match(documentHtml, /model\.voidNote/);
  assert.match(documentPdf, /VOID — RETAINED FOR AUDIT HISTORY/);
  assert.match(documentPdf, /model\.voidReasonLabel/);
});

test("voided Repair Orders cannot be emailed but Print remains available", () => {
  assert.match(emailButton, /status !== "void"/);
  assert.match(emailAction, /model\.status === "void"[\s\S]*cannot be emailed/);
  assert.match(emailButton, /href=\{printHref\}/);
});

test("numbered Repair Orders have no live UI or server action that physically deletes them", async () => {
  const sources = await Promise.all([
    read("src/app/(app)/repair-orders/page.tsx"),
    read("src/app/(app)/repair-orders/[id]/page.tsx"),
    read("src/app/(app)/repair-orders/void-actions.ts"),
    read("src/components/void-repair-order-button.tsx"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /repairOrder\.delete(?:Many)?|deleteDraftRepairOrder|DeleteRepairOrderButton|delete_draft_repair_order/);
  await assert.rejects(read("src/app/(app)/repair-orders/delete-actions.ts"));
  await assert.rejects(read("src/components/delete-repair-order-button.tsx"));
});

test("Prisma fields and migration add nullable audit metadata without destructive SQL", () => {
  for (const field of ["voidedAt", "voidedByUserId", "voidReason", "voidNote"]) assert.match(schema, new RegExp(`\\b${field}\\s+`));
  for (const column of ["voided_at", "voided_by_user_id", "void_reason", "void_note"]) assert.match(migration, new RegExp(`ADD COLUMN \\"${column}\\"`));
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE/i);
});
