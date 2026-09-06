import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";
import { formatDate, formatLaborDescription, formatMoney } from "@/lib/formatters";
import { snapshotNumber, snapshotString } from "@/lib/invoice-snapshots";

export const REPAIR_ORDER_HISTORY_PAGE_SIZE = 25;
export type RepairOrderHistorySource = "invoice" | "repairOrder";
export type RepairOrderHistoryCursor = { serviceDate: string; source: RepairOrderHistorySource; id: string };

export type RepairOrderHistoryRow = {
  source: RepairOrderHistorySource;
  id: string;
  number: string;
  serviceDate: string;
  date: string;
  status: string;
  odometer: string | null;
  summary: string;
  total: string;
  customerId: string;
  vehicleId: string;
  vehicle: string;
};

export type RepairOrderHistoryDetail = RepairOrderHistoryRow & {
  lifecycleLabel: string;
  legacyReadOnly: boolean;
  createdDate: string;
  completedDate: string | null;
  customerName: string;
  complaint: string | null;
  recommendation: string | null;
  notes: string | null;
  concern: string | null;
  parts: Array<{ id: string; description: string; partNumber: string | null; vendor: string | null; quantity: string; unitPrice: string; amount: string }>;
  labor: Array<{ id: string; description: string; hours: string; hourlyRate: string; amount: string }>;
  complimentaryServices: Array<{ id: string; description: string }>;
  totals: { parts: string; labor: string; subtotal: string; shopSupplies: string | null; tax: string; total: string };
};

type HistoryScope = { shopId: string; customerId: string; vehicleId?: string; currentRepairOrderId?: string };
type UnifiedHistoryKey = { source: RepairOrderHistorySource; id: string; serviceDate: Date };

async function getHistoryScope(currentRepairOrderId: string): Promise<HistoryScope | null> {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return null;
  const current = await prisma.repairOrder.findFirst({
    where: { id: currentRepairOrderId, shopId: membership.shopId },
    select: { id: true, customerId: true, vehicleId: true },
  });
  return current ? { shopId: membership.shopId, customerId: current.customerId, vehicleId: current.vehicleId, currentRepairOrderId: current.id } : null;
}

async function getCustomerHistoryScope(customerId: string, currentRepairOrderId?: string): Promise<HistoryScope | null> {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return null;
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId: membership.shopId }, select: { id: true } });
  if (!customer) return null;
  if (!currentRepairOrderId) return { shopId: membership.shopId, customerId: customer.id };
  const current = await prisma.repairOrder.findFirst({ where: { id: currentRepairOrderId, shopId: membership.shopId, customerId: customer.id }, select: { id: true } });
  return current ? { shopId: membership.shopId, customerId: customer.id, currentRepairOrderId: current.id } : null;
}

function isHistorySource(value: unknown): value is RepairOrderHistorySource {
  return value === "invoice" || value === "repairOrder";
}

function parseCursor(cursor: RepairOrderHistoryCursor | null | undefined) {
  if (!cursor || !isHistorySource(cursor.source) || typeof cursor.id !== "string") return null;
  const serviceDate = new Date(cursor.serviceDate);
  return Number.isNaN(serviceDate.getTime()) ? null : { ...cursor, serviceDate };
}

function conciseSummary(record: { customerComplaint: string | null; recommendation: string | null; labor: Array<{ description: string }>; parts: Array<{ description: string }> }, source: RepairOrderHistorySource) {
  const candidates = source === "invoice"
    ? [record.labor[0]?.description, record.parts[0]?.description, record.customerComplaint, record.recommendation]
    : [record.customerComplaint, record.labor[0]?.description, record.parts[0]?.description, record.recommendation];
  const value = candidates.find((candidate) => candidate?.trim())?.trim().replace(/\s+/g, " ");
  return value || "No work summary recorded";
}

function historyNumber(repairOrderNumber: number | null, legacyRoNo: string | null) {
  return String(repairOrderNumber ?? legacyRoNo ?? "Not assigned");
}

function vehicleName(year: number | null, make: string | null, model: string | null) {
  return [year, make, model].filter(Boolean).join(" ") || "Vehicle details unavailable";
}

function serviceOdometer(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 10_000_000) return value.toLocaleString();
  }
  return null;
}

async function getUnifiedHistoryKeys(scope: HistoryScope, cursor?: RepairOrderHistoryCursor | null) {
  const parsed = parseCursor(cursor);
  const invoiceVehicleClause = scope.vehicleId ? Prisma.sql`AND i.vehicle_id = ${scope.vehicleId}::uuid` : Prisma.empty;
  const repairOrderVehicleClause = scope.vehicleId ? Prisma.sql`AND ro.vehicle_id = ${scope.vehicleId}::uuid` : Prisma.empty;
  const excludedRepairOrderClause = scope.currentRepairOrderId ? Prisma.sql`AND ro.id <> ${scope.currentRepairOrderId}::uuid` : Prisma.empty;
  const cursorClause = parsed ? Prisma.sql`
    AND (service_date, source_rank, id) < (
      ${parsed.serviceDate},
      ${parsed.source === "invoice" ? 1 : 0},
      ${parsed.id}::uuid
    )
  ` : Prisma.empty;
  return prisma.$queryRaw<UnifiedHistoryKey[]>(Prisma.sql`
    WITH unified_history AS (
      SELECT 'invoice'::text AS source, i.id, COALESCE(i.invoice_date, i.created_at) AS service_date, 1 AS source_rank
      FROM invoices i
      WHERE i.shop_id = ${scope.shopId}::uuid
        AND i.customer_id = ${scope.customerId}::uuid
        AND i.vehicle_id IS NOT NULL
        ${invoiceVehicleClause}
      UNION ALL
      SELECT 'repairOrder'::text AS source, ro.id, ro.opened_at AS service_date, 0 AS source_rank
      FROM repair_orders ro
      WHERE ro.shop_id = ${scope.shopId}::uuid
        AND ro.customer_id = ${scope.customerId}::uuid
        ${repairOrderVehicleClause}
        ${excludedRepairOrderClause}
        AND NOT EXISTS (
          SELECT 1 FROM invoices linked_invoice
          WHERE linked_invoice.repair_order_id = ro.id
        )
    )
    SELECT source, id, service_date AS "serviceDate"
    FROM unified_history
    WHERE TRUE ${cursorClause}
    ORDER BY service_date DESC, source_rank DESC, id DESC
    LIMIT ${REPAIR_ORDER_HISTORY_PAGE_SIZE + 1}
  `);
}

export async function getRepairOrderHistory(currentRepairOrderId: string, cursor?: RepairOrderHistoryCursor | null) {
  const scope = await getHistoryScope(currentRepairOrderId);
  return scope ? getHistoryForScope(scope, cursor) : null;
}

async function getHistoryForScope(scope: HistoryScope, cursor?: RepairOrderHistoryCursor | null) {
  const keys = await getUnifiedHistoryKeys(scope, cursor);
  const visibleKeys = keys.slice(0, REPAIR_ORDER_HISTORY_PAGE_SIZE);
  const invoiceIds = visibleKeys.filter((key) => key.source === "invoice").map((key) => key.id);
  const repairOrderIds = visibleKeys.filter((key) => key.source === "repairOrder").map((key) => key.id);
  const vehicleWhere = scope.vehicleId ? { vehicleId: scope.vehicleId } : {};
  const repairOrderIdWhere = scope.currentRepairOrderId ? { in: repairOrderIds, not: scope.currentRepairOrderId } : { in: repairOrderIds };
  const [invoices, repairOrders] = await Promise.all([
    prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, shopId: scope.shopId, customerId: scope.customerId, ...vehicleWhere },
      select: {
        id: true, customerId: true, vehicleId: true, repairOrderNumber: true, legacyRoNo: true,
        invoiceDate: true, createdAt: true, status: true, total: true, customerComplaint: true,
        recommendation: true, odometer: true, vehicleSnapshot: true,
        vehicle: { select: { year: true, make: true, model: true } },
        repairOrder: { select: { odometer: true } },
        labor: { where: { complimentary: false }, orderBy: { createdAt: "asc" }, take: 1, select: { description: true } },
        parts: { orderBy: { createdAt: "asc" }, take: 1, select: { description: true } },
      },
    }),
    prisma.repairOrder.findMany({
      where: { shopId: scope.shopId, customerId: scope.customerId, ...vehicleWhere, id: repairOrderIdWhere, invoices: { none: {} } },
      select: {
        id: true, customerId: true, vehicleId: true, repairOrderNumber: true, legacyRoNo: true,
        openedAt: true, createdAt: true, status: true, odometer: true, estimatedTotal: true,
        customerComplaint: true, recommendation: true,
        vehicle: { select: { year: true, make: true, model: true } },
        labor: { where: { complimentary: false }, orderBy: { createdAt: "asc" }, take: 1, select: { description: true } },
        parts: { orderBy: { createdAt: "asc" }, take: 1, select: { description: true } },
      },
    }),
  ]);
  const rowsByKey = new Map<string, RepairOrderHistoryRow>();
  for (const invoice of invoices) {
    const serviceDate = invoice.invoiceDate ?? invoice.createdAt;
    const odometer = serviceOdometer(invoice.odometer, invoice.repairOrder?.odometer);
    const vehicle = vehicleName(snapshotNumber(invoice.vehicleSnapshot, "year", invoice.vehicle?.year ?? null), snapshotString(invoice.vehicleSnapshot, "make", invoice.vehicle?.make ?? null), snapshotString(invoice.vehicleSnapshot, "model", invoice.vehicle?.model ?? null));
    rowsByKey.set(`invoice:${invoice.id}`, { source: "invoice", id: invoice.id, number: historyNumber(invoice.repairOrderNumber, invoice.legacyRoNo), serviceDate: serviceDate.toISOString(), date: formatDate(serviceDate), status: invoice.status === "void" ? "void" : "completed", odometer, summary: conciseSummary(invoice, "invoice"), total: formatMoney(invoice.total), customerId: invoice.customerId, vehicleId: invoice.vehicleId!, vehicle });
  }
  for (const order of repairOrders) {
    rowsByKey.set(`repairOrder:${order.id}`, { source: "repairOrder", id: order.id, number: historyNumber(order.repairOrderNumber, order.legacyRoNo), serviceDate: order.openedAt.toISOString(), date: formatDate(order.openedAt), status: order.status, odometer: serviceOdometer(order.odometer), summary: conciseSummary(order, "repairOrder"), total: formatMoney(order.estimatedTotal), customerId: order.customerId, vehicleId: order.vehicleId, vehicle: vehicleName(order.vehicle.year, order.vehicle.make, order.vehicle.model) });
  }
  const rows = visibleKeys.flatMap((key) => {
    const row = rowsByKey.get(`${key.source}:${key.id}`);
    return row ? [row] : [];
  });
  const lastKey = visibleKeys.at(-1);
  return { rows, nextCursor: keys.length > REPAIR_ORDER_HISTORY_PAGE_SIZE && lastKey ? { serviceDate: lastKey.serviceDate.toISOString(), source: lastKey.source, id: lastKey.id } satisfies RepairOrderHistoryCursor : null };
}

export async function getCustomerRepairOrderHistory(customerId: string, currentRepairOrderId?: string, cursor?: RepairOrderHistoryCursor | null) {
  const scope = await getCustomerHistoryScope(customerId, currentRepairOrderId);
  return scope ? getHistoryForScope(scope, cursor) : null;
}

type DetailScope = { shopId: string; customerId: string | undefined; vehicleId: string | undefined; excludedRepairOrderId?: string };

async function getScopedHistoryDetail(scope: DetailScope, source: RepairOrderHistorySource, historicalId: string): Promise<RepairOrderHistoryDetail | null> {
  if (historicalId === scope.excludedRepairOrderId) return null;
  if (source === "invoice") {
    const invoice = await prisma.invoice.findFirst({
      where: { id: historicalId, shopId: scope.shopId, customerId: scope.customerId, vehicleId: scope.vehicleId },
      select: {
        id: true, customerId: true, vehicleId: true, repairOrderNumber: true, legacyRoNo: true,
        legacySourceTable: true,
        invoiceDate: true, createdAt: true, closedAt: true, status: true, odometer: true, customerComplaint: true, recommendation: true,
        partsTotal: true, laborTotal: true, subtotal: true, shopSuppliesAmount: true,
        shopSuppliesEnabledSnapshot: true, taxTotal: true, total: true, customerSnapshot: true, vehicleSnapshot: true,
        customer: { select: { displayName: true } },
        vehicle: { select: { year: true, make: true, model: true } },
        repairOrder: { select: { odometer: true } },
        parts: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, partNumber: true, vendorNameSnapshot: true, quantity: true, unitPrice: true } },
        labor: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, hours: true, hourlyRate: true, complimentary: true } },
      },
    });
    if (!invoice || !invoice.vehicleId) return null;
    const serviceDate = invoice.invoiceDate ?? invoice.createdAt;
    const odometer = serviceOdometer(invoice.odometer, invoice.repairOrder?.odometer);
    const vehicle = [snapshotNumber(invoice.vehicleSnapshot, "year", invoice.vehicle?.year ?? null), snapshotString(invoice.vehicleSnapshot, "make", invoice.vehicle?.make ?? null), snapshotString(invoice.vehicleSnapshot, "model", invoice.vehicle?.model ?? null)].filter(Boolean).join(" ") || "Vehicle details unavailable";
    return { source, id: invoice.id, number: historyNumber(invoice.repairOrderNumber, invoice.legacyRoNo), serviceDate: serviceDate.toISOString(), date: formatDate(serviceDate), createdDate: formatDate(invoice.createdAt), completedDate: formatDate(invoice.closedAt ?? serviceDate), status: invoice.status === "void" ? "void" : "completed", lifecycleLabel: invoice.legacySourceTable ? "Legacy service" : invoice.status === "void" ? "VOID Invoice" : "Completed service", legacyReadOnly: Boolean(invoice.legacySourceTable), odometer, summary: conciseSummary(invoice, source), total: formatMoney(invoice.total), customerId: invoice.customerId, vehicleId: invoice.vehicleId, customerName: snapshotString(invoice.customerSnapshot, "displayName", invoice.customer.displayName) ?? invoice.customer.displayName, vehicle, complaint: invoice.customerComplaint, recommendation: invoice.recommendation, concern: null, notes: null, parts: invoice.parts.map((part) => ({ id: part.id, description: part.description, partNumber: part.partNumber, vendor: part.vendorNameSnapshot?.trim() || null, quantity: part.quantity.toString(), unitPrice: formatMoney(part.unitPrice), amount: formatMoney(part.quantity.mul(part.unitPrice).toDecimalPlaces(2)) })), labor: invoice.labor.filter((labor) => !labor.complimentary).map((labor) => ({ id: labor.id, description: formatLaborDescription(labor.description), hours: labor.hours.toString(), hourlyRate: formatMoney(labor.hourlyRate), amount: formatMoney(labor.hours.mul(labor.hourlyRate).toDecimalPlaces(2)) })), complimentaryServices: invoice.labor.filter((labor) => labor.complimentary).map((labor) => ({ id: labor.id, description: formatLaborDescription(labor.description) })), totals: { parts: formatMoney(invoice.partsTotal), labor: formatMoney(invoice.laborTotal), subtotal: formatMoney(invoice.subtotal), shopSupplies: invoice.shopSuppliesEnabledSnapshot === false || invoice.shopSuppliesAmount.isZero() ? null : formatMoney(invoice.shopSuppliesAmount), tax: formatMoney(invoice.taxTotal), total: formatMoney(invoice.total) } };
  }
  const order = await prisma.repairOrder.findFirst({
    where: { id: historicalId, shopId: scope.shopId, customerId: scope.customerId, vehicleId: scope.vehicleId, invoices: { none: {} } },
    select: {
      id: true, customerId: true, vehicleId: true, repairOrderNumber: true, legacyRoNo: true, openedAt: true, createdAt: true,
      closedAt: true, status: true, legacySourceTable: true, odometer: true, concern: true, notes: true, customerComplaint: true, recommendation: true,
      partsTotal: true, laborTotal: true, shopSuppliesEnabledSnapshot: true, shopSuppliesAmount: true, taxTotal: true, estimatedTotal: true,
      customer: { select: { displayName: true } }, vehicle: { select: { year: true, make: true, model: true } },
      parts: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, partNumber: true, vendorNameSnapshot: true, quantity: true, unitPrice: true } },
      labor: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, hours: true, hourlyRate: true, complimentary: true } },
    },
  });
  if (!order) return null;
  const subtotal = order.partsTotal.plus(order.laborTotal).toDecimalPlaces(2);
  return { source, id: order.id, number: historyNumber(order.repairOrderNumber, order.legacyRoNo), serviceDate: order.openedAt.toISOString(), date: formatDate(order.openedAt), createdDate: formatDate(order.createdAt), completedDate: order.closedAt ? formatDate(order.closedAt) : null, status: order.status, lifecycleLabel: order.legacySourceTable ? "Legacy · read only" : order.status === "open" || order.status === "draft" ? "Open Repair Order" : order.status, legacyReadOnly: Boolean(order.legacySourceTable), odometer: serviceOdometer(order.odometer), summary: conciseSummary(order, source), total: formatMoney(order.estimatedTotal), customerId: order.customerId, vehicleId: order.vehicleId, customerName: order.customer.displayName, vehicle: [order.vehicle.year, order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable", complaint: order.customerComplaint, recommendation: order.recommendation, concern: order.concern, notes: order.notes, parts: order.parts.map((part) => ({ id: part.id, description: part.description, partNumber: part.partNumber, vendor: part.vendorNameSnapshot?.trim() || null, quantity: part.quantity.toString(), unitPrice: formatMoney(part.unitPrice), amount: formatMoney(part.quantity.mul(part.unitPrice).toDecimalPlaces(2)) })), labor: order.labor.filter((labor) => !labor.complimentary).map((labor) => ({ id: labor.id, description: formatLaborDescription(labor.description), hours: labor.hours.toString(), hourlyRate: formatMoney(labor.hourlyRate), amount: formatMoney(labor.hours.mul(labor.hourlyRate).toDecimalPlaces(2)) })), complimentaryServices: order.labor.filter((labor) => labor.complimentary).map((labor) => ({ id: labor.id, description: formatLaborDescription(labor.description) })), totals: { parts: formatMoney(order.partsTotal), labor: formatMoney(order.laborTotal), subtotal: formatMoney(subtotal), shopSupplies: order.shopSuppliesEnabledSnapshot ? formatMoney(order.shopSuppliesAmount) : null, tax: formatMoney(order.taxTotal), total: formatMoney(order.estimatedTotal) } };
}

export async function getRepairOrderHistoryDetail(currentRepairOrderId: string, source: unknown, historicalId: string): Promise<RepairOrderHistoryDetail | null> {
  if (!isHistorySource(source)) return null;
  const scope = await getHistoryScope(currentRepairOrderId);
  if (!scope) return null;
  if (historicalId === scope.currentRepairOrderId) return null;
  return getScopedHistoryDetail({ shopId: scope.shopId, customerId: scope.customerId, vehicleId: scope.vehicleId, excludedRepairOrderId: scope.currentRepairOrderId }, source, historicalId);
}

export async function getCustomerRepairOrderHistoryDetail(customerId: string, currentRepairOrderId: string | undefined, source: unknown, historicalId: string): Promise<RepairOrderHistoryDetail | null> {
  if (!isHistorySource(source)) return null;
  const scope = await getCustomerHistoryScope(customerId, currentRepairOrderId);
  if (!scope) return null;
  return getScopedHistoryDetail({ shopId: scope.shopId, customerId: scope.customerId, vehicleId: undefined, excludedRepairOrderId: scope.currentRepairOrderId }, source, historicalId);
}

export async function getServiceHistoryDetail(context: unknown, contextId: string, source: unknown, historicalId: string) {
  if ((context !== "customer" && context !== "vehicle") || !isHistorySource(source)) return null;
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return null;
  if (context === "customer") {
    const customer = await prisma.customer.findFirst({ where: { id: contextId, shopId: membership.shopId }, select: { id: true } });
    return customer ? getScopedHistoryDetail({ shopId: membership.shopId, customerId: customer.id, vehicleId: undefined }, source, historicalId) : null;
  }
  const vehicle = await prisma.vehicle.findFirst({ where: { id: contextId, shopId: membership.shopId }, select: { id: true } });
  return vehicle ? getScopedHistoryDetail({ shopId: membership.shopId, customerId: undefined, vehicleId: vehicle.id }, source, historicalId) : null;
}
