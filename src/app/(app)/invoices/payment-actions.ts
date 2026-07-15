"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set(["cash", "card", "check", "other"]);

export async function recordPayment(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const amountText = String(formData.get("amount") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim().toLowerCase();
  const paymentDate = String(formData.get("paymentDate") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID.test(invoiceId) || !/^\d+(\.\d{1,2})?$/.test(amountText)) {
    throw new Error("Invalid payment.");
  }
  const amount = new Prisma.Decimal(amountText).toDecimalPlaces(2);
  if (!amount.greaterThan(0) || !METHODS.has(method) || note.length > 500) {
    throw new Error("Invalid payment.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new Error("Invalid payment date.");
  }
  const paidAt = new Date(`${paymentDate}T12:00:00.000Z`);
  if (Number.isNaN(paidAt.getTime())) throw new Error("Invalid payment date.");

  const { user, membership } = await requirePermission("record_payment");

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT id FROM invoices
      WHERE id = ${invoiceId}::uuid AND shop_id = ${membership.shopId}::uuid
      FOR UPDATE
    `;
    const invoice = await transaction.invoice.findFirst({
      where: {
        id: invoiceId,
        shopId: membership.shopId,
        legacySourceTable: null,
        repairOrderNumber: { not: null },
        status: "finalized",
      },
      select: {
        id: true,
        customerId: true,
        total: true,
        accountsReceivable: { take: 1, select: { id: true } },
      },
    });
    if (!invoice || !invoice.accountsReceivable[0]) {
      throw new Error("Invoice is not eligible for payment.");
    }
    const existing = await transaction.payment.aggregate({
      where: { invoiceId: invoice.id, shopId: membership.shopId },
      _sum: { amount: true },
    });
    const existingPaid = existing._sum.amount ?? new Prisma.Decimal(0);
    const currentBalance = invoice.total.minus(existingPaid).toDecimalPlaces(2);
    if (amount.greaterThan(currentBalance)) throw new Error("Payment exceeds balance.");

    const paidTotal = existingPaid.plus(amount).toDecimalPlaces(2);
    const balance = invoice.total.minus(paidTotal).toDecimalPlaces(2);
    const paid = balance.equals(0);
    const payment = await transaction.payment.create({
      data: {
        shopId: membership.shopId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount,
        method,
        paidAt,
        reference: note || null,
      },
      select: { id: true },
    });
    await transaction.invoice.update({
      where: { id: invoice.id },
      data: { paidTotal, status: paid ? "paid" : "finalized" },
    });
    await transaction.accountReceivable.update({
      where: { id: invoice.accountsReceivable[0].id },
      data: { balance, status: paid ? "paid" : "open" },
    });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "payment_recorded", "payment", payment.id, { invoiceId: invoice.id, method }) });
  }, { isolationLevel: "Serializable" });

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
}
