import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { buildCustomerActivityRows } from "../src/lib/dashboard-business-overview.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const invoice = (customerId, total, reportingDate) => ({ customerId, total: new Prisma.Decimal(total), reportingDate: new Date(reportingDate) });

test("customer activity classifies distinct customers and reconciles summary counts with detail rows", () => {
  const result = buildCustomerActivityRows(
    [invoice("returning", "100.25", "2026-09-03"), invoice("returning", "49.75", "2026-09-08"), invoice("new", "80", "2026-09-07")],
    [{ id: "returning", displayName: "Alpha", vehicleCount: 2 }, { id: "new", displayName: "Beta", vehicleCount: 1 }],
    new Map([["returning", new Date("2026-08-20")]]),
  );
  assert.equal(result.returning.length, result.returningCustomers);
  assert.equal(result.newCustomers.length, result.newCustomerCount);
  assert.equal(result.returningCustomers, 1);
  assert.equal(result.newCustomerCount, 1);
  assert.equal(result.returning[0].visitsThisMonth, 2);
  assert.equal(result.returning[0].salesThisMonth.toString(), "150");
  assert.equal(result.returning[0].lastPriorVisit.toISOString(), "2026-08-20T00:00:00.000Z");
  assert.equal(result.newCustomers[0].firstVisitThisMonth.toISOString(), "2026-09-07T00:00:00.000Z");
});

test("customer activity handles empty returning and new lists", () => {
  const result = buildCustomerActivityRows([], [], new Map());
  assert.equal(result.returning.length, 0);
  assert.equal(result.newCustomers.length, 0);
  assert.equal(result.returningCustomerRate, 0);
});

test("shared query is shop scoped, uses reportable predicates, grouped prior history, and no per-customer loop queries", async () => {
  const data = await read("src/lib/data/customer-activity.ts");
  assert.match(data, /reportableSaleWhere\(shopId, current\)/);
  assert.match(data, /reportableSaleBeforeWhere\(shopId, current\.start\)/);
  assert.match(data, /where: \{ shopId, id: \{ in: customerIds \} \}/);
  assert.match(data, /groupBy\([\s\S]*_max: \{ closedAt: true \}/);
  assert.match(data, /groupBy\([\s\S]*_max: \{ invoiceDate: true \}/);
  assert.doesNotMatch(data, /for \([^)]*customer[^)]*\)[\s\S]*prisma\./);
});

test("dashboard card and URL-driven page expose the reconciled segments", async () => {
  const [dashboard, detail, dashboardData] = await Promise.all([
    read("src/app/(app)/dashboard/page.tsx"),
    read("src/app/(app)/dashboard/customer-insights/page.tsx"),
    read("src/lib/data/dashboard.ts"),
  ]);
  assert.match(dashboard, /href: "\/dashboard\/customer-insights"/);
  assert.match(dashboard, /View customers →/);
  assert.match(detail, /segment === "new" \? "new" : "returning"/);
  assert.match(detail, /Returning \(\{activity\.returningCustomers\}\)/);
  assert.match(detail, /New \(\{activity\.newCustomerCount\}\)/);
  assert.match(detail, /No returning customers serviced this month\./);
  assert.match(detail, /No new customers serviced this month\./);
  assert.match(dashboardData, /getCurrentMonthCustomerActivityForShop\(shopId, now\)/);
});
