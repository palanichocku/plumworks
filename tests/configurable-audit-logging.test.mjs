import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditEntry, writeAuditEntry } from "../src/lib/audit.ts";
import { applyInvoicePayment, invoiceStateAfterPayment } from "../src/lib/invoice-payments.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const entry = (shopId, action = "payment_recorded") => auditEntry(shopId, "00000000-0000-4000-8000-000000000010", action, "payment", "00000000-0000-4000-8000-000000000020");
const auditClient = () => {
  const rows = [];
  return {
    rows,
    client: { auditLog: { create: async ({ data }) => { rows.push(data); return data; } } },
  };
};

test("disabled operational auditing cannot block partial-payment financial state and writes no audit row", async () => {
  const { client, rows } = auditClient();
  const payment = applyInvoicePayment("100.00", "0.00", "40.00");
  const invoice = invoiceStateAfterPayment(payment, new Date("2026-08-30T15:00:00Z"));
  const result = await writeAuditEntry(client, entry("00000000-0000-4000-8000-000000000001"), { category: "operational", enabled: false });
  assert.deepEqual([payment.paidTotal.toFixed(2), payment.balance.toFixed(2), invoice.status, invoice.closedAt], ["40.00", "60.00", "open", null]);
  assert.equal(result, null);
  assert.equal(rows.length, 0);
});

test("disabled operational auditing permits final-payment closure without payment or close audit rows", async () => {
  const { client, rows } = auditClient();
  const payment = applyInvoicePayment("100.00", "40.00", "60.00");
  const recordedAt = new Date("2026-08-30T16:30:00Z");
  const invoice = invoiceStateAfterPayment(payment, recordedAt);
  await writeAuditEntry(client, entry("00000000-0000-4000-8000-000000000001"), { category: "operational", enabled: false });
  await writeAuditEntry(client, entry("00000000-0000-4000-8000-000000000001", "invoice_closed"), { category: "operational", enabled: false });
  assert.deepEqual(invoice, { status: "closed", closedAt: recordedAt });
  assert.equal(payment.balance.toFixed(2), "0.00");
  assert.equal(rows.length, 0);
  const page = await read("src/app/(app)/invoices/[id]/page.tsx");
  assert.match(page, /Payment recorded\. Invoice paid in full and closed\./);
});

test("enabled operational auditing preserves existing detail", async () => {
  const { client, rows } = auditClient();
  await writeAuditEntry(client, entry("00000000-0000-4000-8000-000000000001"), { category: "operational", enabled: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "payment_recorded");
});

test("governance events remain unconditional while representative CRUD is optional", async () => {
  const { client, rows } = auditClient();
  await writeAuditEntry(client, entry("00000000-0000-4000-8000-000000000001", "member_role_changed"), { category: "governance" });
  assert.equal(rows.length, 1);
  const [staff, customer] = await Promise.all([
    read("src/app/(app)/admin/staff/actions.ts"),
    read("src/app/(app)/customers/edit-actions.ts"),
  ]);
  assert.match(staff, /member_role_changed[\s\S]*category: "governance"/);
  assert.match(customer, /customer_updated[\s\S]*category: "operational"[\s\S]*auditLoggingEnabled/);
});

test("audit policy is tenant-local and does not delete existing history", async () => {
  const first = auditClient();
  const second = auditClient();
  await writeAuditEntry(first.client, entry("00000000-0000-4000-8000-000000000001"), { category: "operational", enabled: false });
  await writeAuditEntry(second.client, entry("00000000-0000-4000-8000-000000000002"), { category: "operational", enabled: true });
  assert.equal(first.rows.length, 0);
  assert.equal(second.rows.length, 1);
  const [action, migration] = await Promise.all([
    read("src/app/(app)/admin/shop-settings/actions.ts"),
    read("prisma/migrations/20260830120000_add_shop_audit_logging_setting/migration.sql"),
  ]);
  assert.doesNotMatch(action + migration, /auditLog\.(?:delete|deleteMany)|DELETE FROM "audit_logs"|TRUNCATE/i);
});

test("Admin setting is Shop-scoped, permission protected, and configuration changes remain governed", async () => {
  const [page, action, permissions, membership] = await Promise.all([
    read("src/app/(app)/admin/shop-settings/page.tsx"),
    read("src/app/(app)/admin/shop-settings/actions.ts"),
    read("src/lib/permission-matrix.json"),
    read("src/lib/data/membership.ts"),
  ]);
  assert.match(page, />Audit Logging</);
  assert.match(page, /Turning this off stops new operational audit entries\. Existing audit history is retained\./);
  assert.match(action, /requirePermission\("edit_shop_settings"\)/);
  assert.match(action, /where: \{ id: membership\.shopId \}/);
  assert.match(action, /shop_settings_updated[\s\S]*category: "governance"/);
  assert.match(membership, /auditLoggingEnabled: true/);
  const matrix = JSON.parse(permissions);
  assert.ok(matrix.OWNER.includes("edit_shop_settings"));
  assert.ok(matrix.ADMIN.includes("edit_shop_settings"));
  assert.ok(!matrix.STAFF.includes("edit_shop_settings"));
});
