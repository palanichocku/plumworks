"use server";

import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteDraftRepairOrder(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  if (!UUID.test(repairOrderId)) redirect("/repair-orders");
  const { membership } = await getCurrentMembership();
  if (!membership) redirect("/login");

  await prisma.$transaction(async (transaction) => {
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
      select: { id: true },
    });
    if (order) {
      await transaction.repairOrder.delete({ where: { id: order.id } });
    }
  });
  redirect("/repair-orders");
}
