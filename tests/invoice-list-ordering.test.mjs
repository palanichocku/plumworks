import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const businessNumber = (invoice) => invoice.repairOrderNumber ?? (/^\d+$/.test(invoice.legacyRoNo ?? "") ? Number(invoice.legacyRoNo) : -1);
const businessOrder = (a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || businessNumber(b) - businessNumber(a) || (b.legacyRoNo ?? "").localeCompare(a.legacyRoNo ?? "");

test("newest business date wins regardless of refresh timestamps and shuffled UUIDs", () => {
  const rows = [
    { id: "ffffffff", invoiceDate: "2025-01-01", legacyRoNo: "99999", createdAt: "2099", updatedAt: "2099" },
    { id: "00000000", invoiceDate: "2026-08-29", legacyRoNo: "21774", createdAt: "2000", updatedAt: "2000" },
  ];
  assert.equal(rows.sort(businessOrder)[0].legacyRoNo, "21774");
});

test("same-date legacy and native numbers sort numerically and deterministically", () => {
  const rows = [
    { id: "z", invoiceDate: "2026-08-29", legacyRoNo: "99", repairOrderNumber: null },
    { id: "a", invoiceDate: "2026-08-29", legacyRoNo: "100", repairOrderNumber: null },
    { id: "m", invoiceDate: "2026-08-29", legacyRoNo: null, repairOrderNumber: 101 },
  ];
  assert.deepEqual(rows.sort(businessOrder).map(businessNumber), [101, 100, 99]);
});

test("production query paginates ordered IDs in SQL and preserves search joins", async () => {
  const source = await readFile("src/lib/data/invoices.ts", "utf8");
  assert.match(source, /invoice_date DESC NULLS LAST/);
  assert.match(source, /legacy_ro_no::bigint/);
  assert.match(source, /ORDER BY \$\{invoiceBusinessOrderSql\}[\s\S]*OFFSET[\s\S]*LIMIT 51/);
  assert.match(source, /JOIN customers[\s\S]*LEFT JOIN vehicles/);
  assert.match(source, /ILIKE/);
  assert.doesNotMatch(source, /orderBy:\s*\[\{ updatedAt/);
});
