import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { currentUtcMonthRange } from "../src/lib/dashboard-summary.ts";
import { formatMoney } from "../src/lib/formatters.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, data, formatters, leadContext] = await Promise.all([
  read("src/app/(app)/dashboard/page.tsx"),
  read("src/lib/data/dashboard.ts"),
  read("src/lib/formatters.ts"),
  read("src/lib/marketing-lead-context.ts"),
]);

test("dashboard renders exactly the five requested summary cards", () => {
  for (const label of ["Open Repair Orders", "Customers", "Vehicles", "Invoices This Month", "New Leads"]) assert.match(page, new RegExp(`label: "${label}"`));
  assert.equal((page.match(/label: "/g) ?? []).length, 5);
  assert.doesNotMatch(page, /Open receivables|Open AR balance|Web draft\/open orders|Invoices, last 30 days/i);
});

test("dashboard renders no receivable activity or receivable data query", () => {
  assert.doesNotMatch(page, /Open Receivables|Open AR Balance|Unpaid Receivables|Accounts Receivable/i);
  assert.doesNotMatch(page, /accounts-receivable|unpaidInvoices/i);
  assert.doesNotMatch(data, /accountReceivable|unpaidInvoices/i);
});

test("current invoice month uses UTC calendar boundaries", () => {
  const january = currentUtcMonthRange(new Date("2026-01-31T23:59:59.999Z"));
  assert.equal(january.start.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(january.endExclusive.toISOString(), "2026-02-01T00:00:00.000Z");
  const december = currentUtcMonthRange(new Date("2026-12-20T12:00:00.000Z"));
  assert.equal(december.endExclusive.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.match(data, /invoiceDate: \{ gte: currentMonth\.start, lt: currentMonth\.endExclusive \}/);
});

test("monthly invoices use one shop-scoped aggregate over stored total", () => {
  assert.match(data, /prisma\.invoice\.aggregate/);
  assert.match(data, /where: \{ shopId, invoiceDate:/);
  assert.match(data, /_count: \{ _all: true \}/);
  assert.match(data, /_sum: \{ total: true \}/);
  assert.match(page, /formatMoney\(summary\.monthlyInvoiceTotal\)/);
  assert.equal(formatMoney(null), "$0.00");
});

test("open repair orders, customers, vehicles, and leads remain shop scoped", () => {
  assert.match(data, /repairOrder\.count\(\{ where: operationalRepairOrderWhere\(shopId\) \}\)/);
  assert.match(data, /customer\.count\(\{ where: \{ shopId \} \}/);
  assert.match(data, /vehicle\.count\(\{ where: \{ shopId \} \}/);
  assert.match(data, /marketingLead\.count/);
  assert.match(data, /where: \{ shopId, status: "NEW"/);
});

test("new leads exclude the existing synthetic call-click marker", () => {
  assert.match(leadContext, /Visitor clicked Call Now/);
  assert.match(data, /NOT: \{ source: "CONTACT", message: callClickMessage \}/);
  assert.match(page, /\/admin\/leads\?status=NEW/);
});

test("card destinations remain existing routes and zero values remain renderable", () => {
  for (const href of ["/repair-orders", "/customers", "/vehicles", "/invoices", "/admin/leads?status=NEW"]) assert.match(page, new RegExp(href.replace(/[/?]/g, "\\$&")));
  assert.match(page, /monthlyInvoiceCount === 1/);
  assert.match(formatters, /const source = value\?\.toString\(\)\.trim\(\) \?\? "0"/);
});
