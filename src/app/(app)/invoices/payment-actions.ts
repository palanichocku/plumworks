"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { applyInvoicePayment, invoiceStateAfterPayment } from "@/lib/invoice-payments";
import { PAYMENT_METHODS, PAYMENT_PAYER_TYPES } from "@/lib/payment-options";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set<string>(PAYMENT_METHODS);
const PAYER_TYPES = new Set<string>(PAYMENT_PAYER_TYPES);

export type PaymentActionState = { status: "idle" | "success" | "error"; message?: string };
export type RecordPaymentResult = { invoiceClosed: boolean };

export async function recordPayment(formData: FormData): Promise<RecordPaymentResult> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const amountText = String(formData.get("amount") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim().toLowerCase();
  const payerType = String(formData.get("payerType") ?? "CUSTOMER").trim().toUpperCase();
  const paymentDate = String(formData.get("paymentDate") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID.test(invoiceId) || !/^\d+(\.\d{1,2})?$/.test(amountText)) {
    throw new Error("Invalid payment.");
  }
  const amount = new Prisma.Decimal(amountText).toDecimalPlaces(2);
  if (!amount.greaterThan(0) || !METHODS.has(method) || !PAYER_TYPES.has(payerType) || reference.length > 100 || note.length > 500) {
    throw new Error("Invalid payment.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new Error("Invalid payment date.");
  }
  const paidAt = new Date(`${paymentDate}T12:00:00.000Z`);
  if (Number.isNaN(paidAt.getTime())) throw new Error("Invalid payment date.");

  const { user, membership } = await requirePermission("record_payment");

  const result = await prisma.$transaction(async (transaction) => {
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
        status: "open",
      },
      select: {
        id: true,
        customerId: true,
        repairOrderNumber: true,
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
    const applied = applyInvoicePayment(invoice.total, existingPaid, amount);
    const payment = await transaction.payment.create({
      data: {
        shopId: membership.shopId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount,
        method,
        payerType: payerType as "CUSTOMER" | "INSURANCE" | "WARRANTY" | "OTHER",
        paidAt,
        reference: reference || null,
        note: note || null,
      },
      select: { id: true },
    });
    const recordedAt = new Date();
    const invoiceState = invoiceStateAfterPayment(applied, recordedAt);
    await transaction.invoice.update({
      where: { id: invoice.id },
      data: {
        paidTotal: applied.paidTotal,
        ...invoiceState,
        closedByUserId: invoiceState.status === "closed" ? user?.id ?? null : null,
      },
    });
    await transaction.accountReceivable.update({
      where: { id: invoice.accountsReceivable[0].id },
      data: { balance: applied.balance, status: applied.status === "paid" ? "paid" : "open" },
    });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "payment_recorded", "payment", payment.id, { invoiceId: invoice.id, method, payerType: payerType.toLowerCase() }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `Invoice RO #${invoice.repairOrderNumber}`, entityHref: `/invoices/${invoice.id}`, contextSummary: "Payment recorded" }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
    if (invoiceState.status === "closed") {
      await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "invoice_closed", "invoice", invoice.id, { paymentId: payment.id, automatic: true }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `Invoice RO #${invoice.repairOrderNumber}`, entityHref: `/invoices/${invoice.id}`, contextSummary: "Invoice automatically closed after final payment" }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
    }
    return { invoiceClosed: invoiceState.status === "closed" };
  }, { isolationLevel: "Serializable" });

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/accounts-receivable");
  return result;
}

export async function recordPaymentWithState(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  let result: RecordPaymentResult;
  try {
    result = await recordPayment(formData);
  } catch (error) {
    const message = error instanceof Error && (
      error.message.startsWith("Payment cannot exceed") ||
      error.message.startsWith("Payment amount must") ||
      error.message === "Invoice has no remaining balance."
    ) ? error.message : "Payment could not be recorded. Check the values and try again.";
    return { status: "error", message };
  }
  if (result.invoiceClosed) redirect(`/invoices/${String(formData.get("invoiceId"))}?payment=closed`);
  return { status: "success", message: "Payment recorded." };
}
