"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { calculateEditableInvoiceTotals } from "@/lib/invoice-lifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createInvoiceFromRepairOrder(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  const { user, membership } = await requirePermission("finalize_repair_order");

  const invoice = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT id FROM repair_orders
      WHERE id = ${repairOrderId}::uuid
        AND shop_id = ${membership.shopId}::uuid
      FOR UPDATE
    `;

    const existingInvoice = await transaction.invoice.findUnique({
      where: { repairOrderId },
      select: { id: true },
    });
    if (existingInvoice) return existingInvoice;

    const order = await transaction.repairOrder.findFirst({
      where: {
        id: repairOrderId,
        shopId: membership.shopId,
        legacySourceTable: null,
        repairOrderNumber: { not: null },
        status: { in: ["draft", "open"] },
      },
      select: {
        id: true,
        shopId: true,
        customerId: true,
        vehicleId: true,
        repairOrderNumber: true,
        customerComplaint: true,
        recommendation: true,
        shopSuppliesAmount: true,
        shopSuppliesEnabledSnapshot: true,
        shopSuppliesRateSnapshot: true,
        shopSuppliesCapSnapshot: true,
        shopSuppliesTaxableSnapshot: true,
        shopSuppliesEligibleLaborTotal: true,
        shopSuppliesCalculatedAmount: true,
        shopSuppliesOverrideAmount: true,
        shopSuppliesOverrideReason: true,
        shopSuppliesOverriddenByUserId: true,
        shopSuppliesOverriddenAt: true,
        shop: { select: { name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true, defaultTaxRate: true, partsTaxable: true, laborTaxable: true, invoiceFooterMessage: true, warrantyText: true, invoicePartsWarrantyText: true, invoiceAuthorizationText: true, invoiceCertificationText: true, repairFacilityRegistrationNumber: true, defaultAuthorizedRepresentative: true, defaultInvoiceTechnicianName: true, defaultInvoiceTechnicianLicenseNumber: true } },
        customer: { select: { displayName: true, phone: true, email: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true } },
        vehicle: { select: { year: true, make: true, model: true, engine: true, vin: true, licensePlate: true, odometer: true } },
        parts: { orderBy: { createdAt: "asc" }, select: { description: true, partNumber: true, quantity: true, unitPrice: true, vendorNameSnapshot: true, legacyLineKey: true } },
        labor: { orderBy: { createdAt: "asc" }, select: { description: true, hours: true, hourlyRate: true, legacyLineKey: true } },
      },
    });
    if (!order || order.repairOrderNumber === null) {
      throw new Error("Repair order cannot be converted to an invoice.");
    }

    const zero = new Prisma.Decimal(0);
    const totals = calculateEditableInvoiceTotals({
      parts: order.parts,
      labor: order.labor,
      shopSuppliesEnabled: order.shopSuppliesEnabledSnapshot,
      shopSuppliesRate: order.shopSuppliesRateSnapshot,
      shopSuppliesCap: order.shopSuppliesCapSnapshot,
      taxRate: order.shop.defaultTaxRate,
      partsTaxable: order.shop.partsTaxable,
      laborTaxable: order.shop.laborTaxable,
      shopSuppliesTaxable: order.shopSuppliesTaxableSnapshot,
    });
    const { partsTotal, laborTotal, subtotal, taxTotal, total } = totals;
    const now = new Date();

    const createdInvoice = await transaction.invoice.create({
      data: {
        shopId: order.shopId,
        repairOrderId: order.id,
        repairOrderNumber: order.repairOrderNumber,
        customerId: order.customerId,
        vehicleId: order.vehicleId,
        status: "open",
        invoiceDate: now,
        partsTotal,
        laborTotal,
        subtotal,
        taxTotal,
        total,
        paidTotal: zero,
        customerComplaint: order.customerComplaint,
        recommendation: order.recommendation,
        shopSuppliesAmount: totals.shopSuppliesAmount,
        shopSuppliesEnabledSnapshot: order.shopSuppliesEnabledSnapshot,
        shopSuppliesRateSnapshot: order.shopSuppliesRateSnapshot,
        shopSuppliesCapSnapshot: order.shopSuppliesCapSnapshot,
        shopSuppliesTaxableSnapshot: order.shopSuppliesTaxableSnapshot,
        shopSuppliesEligibleLaborTotal: totals.shopSuppliesEligibleLaborTotal,
        shopSuppliesCalculatedAmount: totals.shopSuppliesCalculatedAmount,
        shopSuppliesWasOverridden: order.shopSuppliesOverrideAmount !== null,
        shopSuppliesOverrideReason: order.shopSuppliesOverrideReason,
        shopSuppliesOverriddenByUserId: order.shopSuppliesOverriddenByUserId,
        shopSuppliesOverriddenAt: order.shopSuppliesOverriddenAt,
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
            vendorNameSnapshot: line.vendorNameSnapshot,
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
        status: "invoiced",
        closedAt: now,
        partsTotal,
        laborTotal,
        taxTotal,
        estimatedTotal: total,
        shopSuppliesEligibleLaborTotal: totals.shopSuppliesEligibleLaborTotal,
        shopSuppliesCalculatedAmount: totals.shopSuppliesCalculatedAmount,
        shopSuppliesAmount: totals.shopSuppliesAmount,
      },
    });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "invoice_created", "repair_order", order.id, { invoiceId: createdInvoice.id }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/invoices/${createdInvoice.id}`, contextSummary: "Invoice created from repair order" }) });
    return createdInvoice;
  }, { isolationLevel: "Serializable" });

  revalidatePath("/repair-orders");
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}
