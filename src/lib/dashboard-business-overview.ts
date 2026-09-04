import { Prisma } from "@prisma/client";

const SHOP_TIME_ZONE = "America/Detroit";
const zero = () => new Prisma.Decimal(0);

function shopDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  return {
    year: Number(parts.find(({ type }) => type === "year")?.value),
    month: Number(parts.find(({ type }) => type === "month")?.value),
  };
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function dashboardMonthRanges(now = new Date()) {
  const current = shopDateParts(now);
  const previousDate = new Date(Date.UTC(current.year, current.month - 2, 1));
  const nextDate = new Date(Date.UTC(current.year, current.month, 1));
  const previous = { year: previousDate.getUTCFullYear(), month: previousDate.getUTCMonth() + 1 };
  const next = { year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() + 1 };
  return {
    current: {
      start: new Date(`${monthKey(current.year, current.month)}-01T00:00:00Z`),
      endExclusive: new Date(`${monthKey(next.year, next.month)}-01T00:00:00Z`),
    },
    previous: {
      start: new Date(`${monthKey(previous.year, previous.month)}-01T00:00:00Z`),
      endExclusive: new Date(`${monthKey(current.year, current.month)}-01T00:00:00Z`),
    },
  };
}

export function exclusiveMonthRanges(now = new Date()) {
  const ranges = dashboardMonthRanges(now);
  return {
    current: { start: ranges.current.start, endExclusive: ranges.current.endExclusive },
    previous: { start: ranges.previous.start, endExclusive: ranges.current.start },
  };
}

export function percentageChange(current: Prisma.Decimal, previous: Prisma.Decimal) {
  if (previous.isZero()) return null;
  return current.minus(previous).div(previous).mul(100).toDecimalPlaces(1).toNumber();
}

export function averageInvoice(total: Prisma.Decimal | null, count: number) {
  return count === 0 ? zero() : (total ?? zero()).div(count).toDecimalPlaces(2);
}

export function agedRepairOrderCutoff(now = new Date()) {
  return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
}

type ActivityInvoice = { customerId: string; total: Prisma.Decimal; reportingDate: Date };
type ActivityCustomer = { id: string; displayName: string; vehicleCount: number };

export type CustomerActivityRow = {
  customerId: string;
  customerName: string;
  vehicleCount: number;
  visitsThisMonth: number;
  salesThisMonth: Prisma.Decimal;
  firstVisitThisMonth: Date;
  lastPriorVisit: Date | null;
  segment: "returning" | "new";
};

export function buildCustomerActivityRows(invoices: ActivityInvoice[], customers: ActivityCustomer[], priorVisits: Map<string, Date>) {
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const rows = new Map<string, CustomerActivityRow>();
  for (const invoice of invoices) {
    const customer = customerMap.get(invoice.customerId);
    if (!customer) continue;
    const existing = rows.get(invoice.customerId);
    if (existing) {
      existing.visitsThisMonth += 1;
      existing.salesThisMonth = existing.salesThisMonth.plus(invoice.total);
      if (invoice.reportingDate < existing.firstVisitThisMonth) existing.firstVisitThisMonth = invoice.reportingDate;
      continue;
    }
    const lastPriorVisit = priorVisits.get(invoice.customerId) ?? null;
    rows.set(invoice.customerId, { customerId: invoice.customerId, customerName: customer.displayName, vehicleCount: customer.vehicleCount, visitsThisMonth: 1, salesThisMonth: new Prisma.Decimal(invoice.total), firstVisitThisMonth: invoice.reportingDate, lastPriorVisit, segment: lastPriorVisit ? "returning" : "new" });
  }
  const all = [...rows.values()];
  const returning = all.filter((row) => row.segment === "returning").sort((left, right) => right.salesThisMonth.comparedTo(left.salesThisMonth) || left.customerName.localeCompare(right.customerName) || left.customerId.localeCompare(right.customerId));
  const newCustomers = all.filter((row) => row.segment === "new").sort((left, right) => right.firstVisitThisMonth.getTime() - left.firstVisitThisMonth.getTime() || left.customerName.localeCompare(right.customerName) || left.customerId.localeCompare(right.customerId));
  const customersServiced = all.length;
  return { returning, newCustomers, returningCustomers: returning.length, newCustomerCount: newCustomers.length, customersServiced, returningCustomerRate: customersServiced === 0 ? 0 : Math.round((returning.length / customersServiced) * 100) };
}
