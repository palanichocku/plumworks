"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function finalizeRepairOrder(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  const { user, membership } = await getCurrentMembership();
  if (!membership) throw new Error("Shop access is required.");

  const invoice = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT id FROM repair_orders
      WHERE id = ${repairOrderId}::uuid
        AND shop_id = ${membership.shopId}::uuid
      FOR UPDATE
    `;

    const order = await transaction.repairOrder.findFirst({
      where: {
        id: repairOrderId,
        shopId: membership.shopId,
        legacySourceTable: null,
        repairOrderNumber: { not: null },
        status: { in: ["draft", "open"] },
        invoices: { none: {} },
      },
      select: {
        id: true,
        shopId: true,
        customerId: true,
        vehicleId: true,
        repairOrderNumber: true,
        shop: { select: { name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true, defaultTaxRate: true, partsTaxable: true, laborTaxable: true, invoiceFooterMessage: true, warrantyText: true } },
        customer: { select: { displayName: true, phone: true, email: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true } },
        vehicle: { select: { year: true, make: true, model: true, engine: true, vin: true, licensePlate: true, odometer: true } },
        parts: { orderBy: { createdAt: "asc" }, select: { description: true, partNumber: true, quantity: true, unitPrice: true, legacyLineKey: true } },
        labor: { orderBy: { createdAt: "asc" }, select: { description: true, hours: true, hourlyRate: true, legacyLineKey: true } },
      },
    });
    if (!order || order.repairOrderNumber === null) {
      throw new Error("Repair order cannot be finalized.");
    }

    const zero = new Prisma.Decimal(0);
    const partsTotal = order.parts.reduce(
      (sum, line) => sum.plus(line.quantity.mul(line.unitPrice).toDecimalPlaces(2)),
      zero,
    ).toDecimalPlaces(2);
    const laborTotal = order.labor.reduce(
      (sum, line) => sum.plus(line.hours.mul(line.hourlyRate).toDecimalPlaces(2)),
      zero,
    ).toDecimalPlaces(2);
    const subtotal = partsTotal.plus(laborTotal).toDecimalPlaces(2);
    const taxableTotal = (order.shop.partsTaxable ? partsTotal : zero).plus(
      order.shop.laborTaxable ? laborTotal : zero,
    );
    const taxTotal = taxableTotal
      .mul(order.shop.defaultTaxRate)
      .toDecimalPlaces(2);
    const total = subtotal.plus(taxTotal).toDecimalPlaces(2);
    const now = new Date();

    const createdInvoice = await transaction.invoice.create({
      data: {
        shopId: order.shopId,
        repairOrderId: order.id,
        repairOrderNumber: order.repairOrderNumber,
        customerId: order.customerId,
        vehicleId: order.vehicleId,
        status: "finalized",
        invoiceDate: now,
        partsTotal,
        laborTotal,
        subtotal,
        taxTotal,
        total,
        paidTotal: zero,
        shopSnapshot: order.shop,
        customerSnapshot: order.customer,
        vehicleSnapshot: order.vehicle,
        parts: {
          create: order.parts.map((line) => ({
            shopId: order.shopId,
            description: line.description,
            partNumber: line.partNumber,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            legacyLineKey: line.legacyLineKey,
          })),
        },
        labor: {
          create: order.labor.map((line) => ({
            shopId: order.shopId,
            description: line.description,
            hours: line.hours,
            hourlyRate: line.hourlyRate,
            legacyLineKey: line.legacyLineKey,
          })),
        },
        accountsReceivable: {
          create: {
            shopId: order.shopId,
            customerId: order.customerId,
            balance: total,
            status: total.greaterThan(0) ? "open" : "paid",
          },
        },
      },
      select: { id: true },
    });

    await transaction.repairOrder.update({
      where: { id: order.id },
      data: {
        status: "finalized",
        closedAt: now,
        partsTotal,
        laborTotal,
        taxTotal,
        estimatedTotal: total,
      },
    });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "repair_order_finalized", "repair_order", order.id, { invoiceId: createdInvoice.id }) });
    return createdInvoice;
  }, { isolationLevel: "Serializable" });

  revalidatePath("/repair-orders");
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}
