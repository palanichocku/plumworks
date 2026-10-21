"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LineType = "part" | "labor";
type Direction = "up" | "down";

async function ensurePositions(
  tx: Prisma.TransactionClient,
  shopId: string,
  repairOrderId: string,
  lineType: LineType,
) {
  if (lineType === "part") {
    await tx.$executeRaw`
      INSERT INTO repair_order_line_positions
        (shop_id, repair_order_id, line_type, legacy_line_key, sort_order)
      SELECT p.shop_id, p.repair_order_id, 'part', p.legacy_line_key,
             ROW_NUMBER() OVER (PARTITION BY p.shop_id, p.repair_order_id ORDER BY p.created_at, p.id) - 1
      FROM repair_order_parts p
      WHERE p.shop_id = ${shopId}::uuid
        AND p.repair_order_id = ${repairOrderId}::uuid
      ON CONFLICT DO NOTHING
    `;
  } else {
    await tx.$executeRaw`
      INSERT INTO repair_order_line_positions
        (shop_id, repair_order_id, line_type, legacy_line_key, sort_order)
      SELECT l.shop_id, l.repair_order_id, 'labor', l.legacy_line_key,
             ROW_NUMBER() OVER (PARTITION BY l.shop_id, l.repair_order_id ORDER BY l.created_at, l.id) - 1
      FROM repair_order_labor l
      WHERE l.shop_id = ${shopId}::uuid
        AND l.repair_order_id = ${repairOrderId}::uuid
        AND l.complimentary = FALSE
      ON CONFLICT DO NOTHING
    `;
  }
}

export async function reorderRepairOrderLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const lineType = String(formData.get("lineType") ?? "") as LineType;
  const direction = String(formData.get("direction") ?? "") as Direction;

  if (!UUID.test(repairOrderId) || !UUID.test(lineId)) throw new Error("Invalid line item.");
  if (lineType !== "part" && lineType !== "labor") throw new Error("Invalid line type.");
  if (direction !== "up" && direction !== "down") throw new Error("Invalid move direction.");

  const { membership } = await requirePermission("edit_draft_repair_order");
  const order = await prisma.repairOrder.findFirst({
    where: {
      id: repairOrderId,
      shopId: membership.shopId,
      status: { in: ["draft", "open"] },
      legacySourceTable: null,
      invoices: { none: {} },
    },
    select: { id: true },
  });
  if (!order) throw new Error("Repair order is not editable.");

  await prisma.$transaction(async (tx) => {
    await ensurePositions(tx, membership.shopId, repairOrderId, lineType);

    const keyRows = lineType === "part"
      ? await tx.$queryRaw<Array<{ legacy_line_key: string }>>`
          SELECT legacy_line_key
          FROM repair_order_parts
          WHERE id = ${lineId}::uuid
            AND shop_id = ${membership.shopId}::uuid
            AND repair_order_id = ${repairOrderId}::uuid
          LIMIT 1
        `
      : await tx.$queryRaw<Array<{ legacy_line_key: string }>>`
          SELECT legacy_line_key
          FROM repair_order_labor
          WHERE id = ${lineId}::uuid
            AND shop_id = ${membership.shopId}::uuid
            AND repair_order_id = ${repairOrderId}::uuid
            AND complimentary = FALSE
          LIMIT 1
        `;

    const legacyLineKey = keyRows[0]?.legacy_line_key;
    if (!legacyLineKey) throw new Error("Line item is not reorderable.");

    const currentRows = await tx.$queryRaw<Array<{ sort_order: number }>>`
      SELECT sort_order
      FROM repair_order_line_positions
      WHERE shop_id = ${membership.shopId}::uuid
        AND repair_order_id = ${repairOrderId}::uuid
        AND line_type = ${lineType}
        AND legacy_line_key = ${legacyLineKey}
      LIMIT 1
      FOR UPDATE
    `;
    const current = currentRows[0];
    if (!current) throw new Error("Line position could not be found.");

    const neighbors = direction === "up"
      ? await tx.$queryRaw<Array<{ legacy_line_key: string; sort_order: number }>>`
          SELECT legacy_line_key, sort_order
          FROM repair_order_line_positions
          WHERE shop_id = ${membership.shopId}::uuid
            AND repair_order_id = ${repairOrderId}::uuid
            AND line_type = ${lineType}
            AND sort_order < ${current.sort_order}
          ORDER BY sort_order DESC
          LIMIT 1
          FOR UPDATE
        `
      : await tx.$queryRaw<Array<{ legacy_line_key: string; sort_order: number }>>`
          SELECT legacy_line_key, sort_order
          FROM repair_order_line_positions
          WHERE shop_id = ${membership.shopId}::uuid
            AND repair_order_id = ${repairOrderId}::uuid
            AND line_type = ${lineType}
            AND sort_order > ${current.sort_order}
          ORDER BY sort_order ASC
          LIMIT 1
          FOR UPDATE
        `;

    const neighbor = neighbors[0];
    if (!neighbor) return;

    await tx.$executeRaw`
      UPDATE repair_order_line_positions
      SET sort_order = CASE
        WHEN legacy_line_key = ${legacyLineKey} THEN ${neighbor.sort_order}
        WHEN legacy_line_key = ${neighbor.legacy_line_key} THEN ${current.sort_order}
        ELSE sort_order
      END,
      updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ${membership.shopId}::uuid
        AND repair_order_id = ${repairOrderId}::uuid
        AND line_type = ${lineType}
        AND legacy_line_key IN (${legacyLineKey}, ${neighbor.legacy_line_key})
    `;

    await tx.repairOrder.update({ where: { id: repairOrderId }, data: { updatedAt: new Date() } });
  });

  revalidatePath(`/repair-orders/${repairOrderId}`);
}
