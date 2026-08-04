import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";
import { formatDate, formatMoney } from "@/lib/formatters";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const repairOrderDocumentSelect = {
  id: true,
  repairOrderNumber: true,
  status: true,
  openedAt: true,
  closedAt: true,
  customerComplaint: true,
  recommendation: true,
  partsTotal: true,
  laborTotal: true,
  shopSuppliesAmount: true,
  shopSuppliesEnabledSnapshot: true,
  taxTotal: true,
  estimatedTotal: true,
  shop: { select: {
    name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true,
    invoiceFooterMessage: true, warrantyText: true,
  } },
  customer: { select: {
    id: true, displayName: true, addressLine1: true, addressLine2: true, city: true,
    state: true, postalCode: true, phone: true, email: true,
  } },
  vehicle: { select: {
    id: true, year: true, make: true, model: true, engine: true, vin: true,
    licensePlate: true, odometer: true,
  } },
  parts: { orderBy: { createdAt: "asc" as const }, select: {
    description: true, partNumber: true, quantity: true, unitPrice: true,
  } },
  labor: { orderBy: { createdAt: "asc" as const }, select: {
    description: true, hours: true, hourlyRate: true, complimentary: true,
  } },
} satisfies Prisma.RepairOrderSelect;

type RepairOrderDocumentRecord = Prisma.RepairOrderGetPayload<{ select: typeof repairOrderDocumentSelect }>;

export type RepairOrderDocumentModel = ReturnType<typeof mapRepairOrderDocument>;

function mapRepairOrderDocument(order: RepairOrderDocumentRecord) {
  const repairOrderNumber = String(order.repairOrderNumber ?? "Not assigned");
  const safeNumber = repairOrderNumber.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";
  const subtotal = order.partsTotal.plus(order.laborTotal).toDecimalPlaces(2);

  return {
    id: order.id,
    repairOrderNumber,
    filename: `repair-order-${safeNumber}.pdf`,
    status: order.status,
    openedDate: formatDate(order.openedAt),
    closedDate: order.closedAt ? formatDate(order.closedAt) : null,
    shop: order.shop,
    customer: {
      id: order.customer.id,
      name: order.customer.displayName,
      addressLine1: order.customer.addressLine1,
      addressLine2: order.customer.addressLine2,
      city: order.customer.city,
      state: order.customer.state,
      postalCode: order.customer.postalCode,
      phone: order.customer.phone,
      email: order.customer.email,
    },
    vehicle: order.vehicle,
    complaint: order.customerComplaint,
    recommendation: order.recommendation,
    parts: order.parts.map((part) => ({
      description: part.description,
      partNumber: part.partNumber,
      quantity: part.quantity.toString(),
      unitPrice: formatMoney(part.unitPrice),
      amount: formatMoney(part.quantity.mul(part.unitPrice).toDecimalPlaces(2)),
    })),
    labor: order.labor.filter((labor) => !labor.complimentary).map((labor) => ({
      description: labor.description,
      hours: labor.hours.toString(),
      hourlyRate: formatMoney(labor.hourlyRate),
      amount: formatMoney(labor.hours.mul(labor.hourlyRate).toDecimalPlaces(2)),
    })),
    complimentaryServices: order.labor.filter((labor) => labor.complimentary).map((labor) => ({ description: labor.description })),
    totals: {
      parts: formatMoney(order.partsTotal),
      labor: formatMoney(order.laborTotal),
      subtotal: formatMoney(subtotal),
      shopSupplies: order.shopSuppliesEnabledSnapshot ? formatMoney(order.shopSuppliesAmount) : null,
      tax: formatMoney(order.taxTotal),
      estimatedTotal: formatMoney(order.estimatedTotal),
    },
  };
}

export async function getRepairOrderDocumentForShop(repairOrderId: string, shopId: string) {
  if (!UUID.test(repairOrderId)) return null;
  const order = await prisma.repairOrder.findFirst({
    where: {
      id: repairOrderId,
      shopId,
      legacySourceTable: null,
      status: { in: ["draft", "open", "finalized", "invoiced"] },
    },
    select: repairOrderDocumentSelect,
  });
  return order ? mapRepairOrderDocument(order) : null;
}

export async function getRepairOrderDocumentForCurrentShop(repairOrderId: string) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return null;
  return getRepairOrderDocumentForShop(repairOrderId, membership.shopId);
}
