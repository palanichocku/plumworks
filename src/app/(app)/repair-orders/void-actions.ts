"use server";

import { revalidatePath } from "next/cache";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { repairOrderVoidEligibilityError, validateRepairOrderVoidInput, type VoidRepairOrderState } from "@/lib/repair-order-void";

export async function voidRepairOrder(_state: VoidRepairOrderState, formData: FormData): Promise<VoidRepairOrderState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const submittedNote = String(formData.get("note") ?? "").trim();
  const validationError = validateRepairOrderVoidInput(repairOrderId, reason, submittedNote);
  if (validationError) return { status: "error", message: validationError };

  const { user, membership } = await requirePermission("void_repair_order");
  try {
    const order = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id FROM repair_orders
        WHERE id = ${repairOrderId}::uuid
          AND shop_id = ${membership.shopId}::uuid
        FOR UPDATE
      `;
      const current = await transaction.repairOrder.findFirst({
        where: { id: repairOrderId, shopId: membership.shopId },
        select: { id: true, repairOrderNumber: true, status: true, legacySourceTable: true },
      });
      const existingInvoice = current ? await transaction.invoice.findFirst({
        where: { repairOrderId: current.id, shopId: membership.shopId },
        select: { id: true },
      }) : null;
      const eligibilityError = repairOrderVoidEligibilityError(current ? { ...current, hasInvoice: Boolean(existingInvoice) } : null);
      if (eligibilityError) throw new Error(eligibilityError);

      const voidedAt = new Date();
      const voidNote = reason === "OTHER" ? submittedNote : null;
      await transaction.repairOrder.update({
        where: { id: current!.id },
        data: { status: "void", voidedAt, voidedByUserId: user?.id ?? null, voidReason: reason, voidNote },
      });
      await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "repair_order_voided", "repair_order", current!.id, {
        repairOrderNumber: current!.repairOrderNumber!, priorStatus: current!.status, newStatus: "void", reason,
        note: voidNote, voidedByUserId: user?.id ?? null, voidedAt: voidedAt.toISOString(),
      }, {
        actorEmail: user?.email, actorRole: membership.role,
        entityLabel: `RO #${current!.repairOrderNumber}`, entityHref: `/repair-orders/${current!.id}`,
        contextSummary: `Repair Order voided: ${reason}`,
      }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
      return { id: current!.id, repairOrderNumber: current!.repairOrderNumber! };
    }, { isolationLevel: "Serializable" });

    revalidatePath("/repair-orders");
    revalidatePath(`/repair-orders/${order.id}`);
    revalidatePath("/search");
    return { status: "success", message: `RO #${order.repairOrderNumber} has been voided and retained for audit history.` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Repair Order could not be voided." };
  }
}
