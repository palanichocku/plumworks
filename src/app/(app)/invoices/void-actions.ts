"use server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { validateInvoiceVoidInput, type VoidInvoiceState } from "@/lib/invoice-void";

export async function voidInvoice(_state: VoidInvoiceState, formData: FormData): Promise<VoidInvoiceState> {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const reason = String(formData.get("reason") ?? ""); const note = String(formData.get("note") ?? "").trim();
  const validationError = validateInvoiceVoidInput(invoiceId, reason, note);
  if (validationError) return { status: "error", message: validationError };
  const { user, membership } = await requirePermission("finalize_repair_order");
  try {
    const invoice = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND shop_id = ${membership.shopId}::uuid FOR UPDATE`;
      const current = await transaction.invoice.findFirst({ where: { id: invoiceId, shopId: membership.shopId }, select: { id: true, repairOrderNumber: true, status: true, legacySourceTable: true, total: true, customerId: true, vehicleId: true, repairOrderId: true } });
      if (!current) throw new Error("Invoice was not found for this Shop.");
      if (current.legacySourceTable !== null) throw new Error("Historical imported invoices cannot be voided.");
      if (current.status === "void") throw new Error("This invoice has already been voided.");
      if (current.status === "closed") throw new Error("A closed invoice cannot use the normal Void workflow.");
      if (current.status !== "open") throw new Error("This invoice is no longer eligible to be voided.");
      const payments = await transaction.payment.aggregate({ where: { invoiceId: current.id, shopId: membership.shopId }, _count: { _all: true }, _sum: { amount: true } });
      const paymentEffect = payments._sum.amount ?? new Prisma.Decimal(0);
      if (payments._count._all > 0 || !paymentEffect.isZero()) throw new Error("This invoice has payments recorded and cannot be voided. Payments must be reversed or refunded before the invoice can be voided.");
      const voidedAt = new Date();
      await transaction.invoice.update({ where: { id: current.id }, data: { status: "void", voidedAt, voidedByUserId: user?.id ?? null, voidReason: reason, voidNote: note || null } });
      await transaction.accountReceivable.updateMany({ where: { invoiceId: current.id, shopId: membership.shopId }, data: { balance: 0, status: "void" } });
      await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "invoice_voided", "invoice", current.id, { priorStatus: current.status, newStatus: "void", originalTotal: current.total.toString(), reason, voidedBy: user?.id ?? null, voidedAt: voidedAt.toISOString() }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `Invoice RO #${current.repairOrderNumber}`, entityHref: `/invoices/${current.id}`, contextSummary: "Invoice voided" }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
      return current;
    }, { isolationLevel: "Serializable" });
    revalidatePath(`/invoices/${invoice.id}`); revalidatePath("/invoices"); revalidatePath("/accounts-receivable"); revalidatePath("/dashboard"); revalidatePath("/reports");
    return { status: "success", message: `Invoice ${invoice.repairOrderNumber ?? ""} has been voided.`.replace("  ", " ") };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "Invoice could not be voided." }; }
}
