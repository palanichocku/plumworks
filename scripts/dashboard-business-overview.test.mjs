import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  agedRepairOrderCutoff,
  averageInvoice,
  exclusiveMonthRanges,
  percentageChange,
} from "../src/lib/dashboard-business-overview.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard month ranges follow the shop calendar and include the previous complete month", () => {
  const ranges = exclusiveMonthRanges(new Date("2026-09-01T02:00:00Z"));
  assert.equal(ranges.current.start.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(ranges.current.endExclusive.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(ranges.previous.start.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(ranges.previous.endExclusive.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("sales comparisons and Decimal-safe invoice averages handle zero months", () => {
  assert.equal(averageInvoice(new Prisma.Decimal("100.01"), 3).toString(), "33.34");
  assert.equal(averageInvoice(null, 0).toString(), "0");
  assert.equal(percentageChange(new Prisma.Decimal(112.5), new Prisma.Decimal(100)), 12.5);
  assert.equal(percentageChange(new Prisma.Decimal(95.8), new Prisma.Decimal(100)), -4.2);
  assert.equal(percentageChange(new Prisma.Decimal(10), new Prisma.Decimal(0)), null);
});

test("RO attention cutoff is strictly older than three elapsed days", () => {
  assert.equal(agedRepairOrderCutoff(new Date("2026-09-03T16:00:00Z")).toISOString(), "2026-08-31T16:00:00.000Z");
});

test("dashboard queries reuse finalized sales and operational repair-order predicates", async () => {
  const [dashboard, activity, sales, roLifecycle] = await Promise.all([
    read("src/lib/data/dashboard.ts"),
    read("src/lib/data/customer-activity.ts"),
    read("src/lib/reportable-sales.ts"),
    read("src/lib/repair-order-lifecycle.ts"),
  ]);
  assert.match(dashboard, /reportableSaleWhere\(shopId, overviewMonths\.current\)/);
  assert.match(dashboard, /reportableSaleWhere\(shopId, overviewMonths\.previous\)/);
  assert.match(activity, /reportableSaleWhere\(shopId, current\)/);
  assert.match(activity, /reportableSaleBeforeWhere\(shopId, current\.start\)/);
  assert.match(sales, /legacySourceTable: null,[\s\S]*status: "closed",[\s\S]*closedAt/);
  assert.match(sales, /legacySourceTable: \{ not: null \},[\s\S]*invoiceDate/);
  assert.match(activity, /customerId: \{ in: customerIds \}/);
  assert.match(dashboard, /operationalRepairOrderWhere\(shopId\)[\s\S]*openedAt: \{ lt: agedRepairOrderCutoff\(now\) \}/);
  assert.match(roLifecycle, /status: \{ in: \["draft", "open"\] \}/);
  assert.match(roLifecycle, /legacySourceTable: null/);
  assert.match(roLifecycle, /invoices: \{ none: \{\} \}/);
});

test("Business Overview renders all four owner metrics and useful links", async () => {
  const page = await read("src/app/(app)/dashboard/page.tsx");
  for (const label of ["Sales This Month", "Average Invoice", "Returning Customers", "Needs Attention"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /No prior-month comparison/);
  assert.match(page, /No ROs open > 3 days/);
  assert.match(page, /href: "\/repair-orders"/);
});
