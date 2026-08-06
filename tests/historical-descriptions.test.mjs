import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [logic, action, component, rows] = await Promise.all([
  read("src/lib/historical-descriptions.ts"),
  read("src/app/(app)/repair-orders/description-history-actions.ts"),
  read("src/components/historical-description-combobox.tsx"),
  read("src/components/repair-order-line-items.tsx"),
]);

test("history search is authenticated, shop-scoped, bounded, and includes invoice and Repair Order sources", () => {
  assert.match(action, /getCurrentMembership/);
  assert.match(action, /!user \|\| !membership/);
  assert.equal((action.match(/shopId: membership\.shopId/g) ?? []).length, 4);
  for (const model of ["invoicePart", "repairOrderPart", "invoiceLabor", "repairOrderLabor"]) assert.match(action, new RegExp(`prisma\\.${model}\\.findMany`));
  assert.match(action, /HISTORICAL_DESCRIPTION_SOURCE_LIMIT/);
  assert.doesNotMatch(action, /legacySourceTable:\s*null/);
});

test("matching normalizes whitespace and case, deduplicates, ranks, and limits deterministically", () => {
  assert.match(logic, /trim\(\)\.replace\(\/\\s\+\/g, " "\)\.toLocaleLowerCase/);
  assert.match(logic, /if \(description === query\) return 0/);
  assert.match(logic, /description\.startsWith\(query\)/);
  assert.match(logic, /word\.startsWith\(query\)/);
  assert.match(logic, /b\.count - a\.count/);
  assert.match(logic, /b\.usedAt\.getTime\(\) - a\.usedAt\.getTime\(\)/);
  assert.match(logic, /\.slice\(0, limit\)/);
  assert.match(logic, /HISTORICAL_DESCRIPTION_LIMIT = 9/);
});

test("shared accessible picker debounces, protects against stale responses, and preserves free text", () => {
  assert.match(component, /const DEBOUNCE_MS = 275/);
  assert.match(component, /request === sequence\.current/);
  assert.match(component, /role="combobox"/);
  assert.match(component, /aria-expanded/);
  assert.match(component, /aria-controls/);
  assert.match(component, /aria-activedescendant/);
  assert.match(component, /role="listbox"/);
  assert.match(component, /role="option"/);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.match(component, new RegExp(key));
  assert.match(component, /Continue typing to use a new description/);
});

test("parts, billed labor, and complimentary rows share the picker without copying financial fields", () => {
  assert.match(rows, /HistoricalDescriptionCombobox kind="part" rowKey=\{line\.id\}/);
  assert.match(rows, /HistoricalDescriptionCombobox kind="part" rowKey="draft-part"/);
  assert.match(rows, /complimentary = placeholder\.startsWith\("Complimentary"\)/);
  assert.match(rows, /kind=\{complimentary \? "complimentary-labor" : "labor"\}/);
  assert.doesNotMatch(component, /quantity|unitPrice|partNumber|vendor|hours|hourlyRate|complimentary.*onChange/);
});
