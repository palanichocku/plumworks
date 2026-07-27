import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authoritativeReloadCounts,
  parseLegacyCutoverExecution,
  validateProjectedCountConsistency,
} from "./lib/legacy-cutover-preflight.mjs";

const confirmed = [
  "--backup", "--reset-operational-data", "--reload-legacy", "--verify", "--report",
  "--confirm", "RESET_SHOP_OPERATIONAL_DATA",
];

test("confirmation alone fails clearly and full replacement requires every safeguard", () => {
  assert.throws(() => parseLegacyCutoverExecution(["--confirm", "RESET_SHOP_OPERATIONAL_DATA"]), /Confirmation alone/);
  for (const required of ["--backup", "--reset-operational-data", "--reload-legacy", "--verify", "--report"]) {
    assert.throws(() => parseLegacyCutoverExecution(confirmed.filter((value) => value !== required)), /Full replacement requires/);
  }
  const parsed = parseLegacyCutoverExecution(confirmed);
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.confirmedFullReplacement, true);
  assert.throws(() => parseLegacyCutoverExecution([...confirmed, "--dry-run"]), /cannot be combined/);
});

test("preflight and ordinary dry runs have no confirmed execution capability", () => {
  assert.deepEqual(parseLegacyCutoverExecution(["--preflight"]), {
    preflight: true, dryRun: true, confirmedFullReplacement: false,
    requiredFullReplacementFlags: ["--backup", "--reset-operational-data", "--reload-legacy", "--verify", "--report"],
    missingFullReplacementFlags: ["--backup", "--reset-operational-data", "--reload-legacy", "--verify", "--report"],
  });
  assert.equal(parseLegacyCutoverExecution(["--dry-run"]).confirmedFullReplacement, false);
});

test("authoritative reload counts use the active AR-centered Invoice and Payment projections", () => {
  const invoiceProjection = { invoices: [{ legacyRoNo: "1" }, { legacyRoNo: "2" }] };
  const paymentProjection = { proposedRows: [{ id: "p1" }], matchedInvoiceCount: 2 };
  const expected = authoritativeReloadCounts({
    normalCustomers: 10, recoveredCustomers: 2, aliases: 1, vehicles: 8,
    invoiceProjection,
    rawFinal: [
      { legacyRoNo: "1", rawData: { DESC: "Part" } },
      { legacyRoNo: "missing", rawData: { DESC: "Ignored" } },
    ],
    rawLabor: [{ legacyRoNo: "2" }, { legacyRoNo: "missing" }],
    paymentProjection,
    openOrders: { orders: 3, parts: 4, labor: 5 },
  });
  assert.deepEqual(expected, {
    customers: 12, recoveredCustomers: 2, customerAliases: 1, vehicles: 8,
    invoices: 2, invoice_parts: 1, invoice_labor: 1, accounts_receivable: 2,
    payments: 1, repair_orders: 3, repair_order_parts: 4, repair_order_labor: 5,
  });
  assert.deepEqual(validateProjectedCountConsistency({ expected, invoiceProjection, paymentProjection }), []);
});

test("stale reconciliation and projection disagreements are fatal before reset", async () => {
  const invoiceProjection = { invoices: Array.from({ length: 11_665 }, (_, index) => ({ legacyRoNo: String(index) })) };
  const paymentProjection = { matchedInvoiceCount: 11_665, proposedRows: Array.from({ length: 11_825 }, (_, index) => ({ id: String(index) })) };
  const expected = { invoices: 11_665, accounts_receivable: 11_665, payments: 11_825 };
  const issues = validateProjectedCountConsistency({
    expected, invoiceProjection, paymentProjection,
    reconciliationExpected: { invoices: 10_122, accounts_receivable: 10_122 },
  });
  assert.equal(issues.length, 2);
  const source = await readFile("scripts/legacy-cutover.mjs", "utf8");
  assert.ok(source.indexOf("validateProjectedCountConsistency") < source.indexOf("if (wantsReset)"));
  assert.match(source, /Projected post-reload counts disagree/);
});
