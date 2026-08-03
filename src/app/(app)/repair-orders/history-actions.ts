"use server";

import { getRepairOrderHistory, getRepairOrderHistoryDetail, type RepairOrderHistoryCursor } from "@/lib/data/repair-order-history";

export async function loadRepairOrderHistory(currentRepairOrderId: string, cursor?: RepairOrderHistoryCursor | null) {
  try {
    const result = await getRepairOrderHistory(currentRepairOrderId, cursor);
    return result ? { ok: true as const, ...result } : { ok: false as const, message: "Repair Order history is unavailable." };
  } catch {
    return { ok: false as const, message: "Repair Order history could not be loaded. Please try again." };
  }
}

export async function loadRepairOrderHistoryDetail(currentRepairOrderId: string, source: unknown, historicalId: string) {
  try {
    const detail = await getRepairOrderHistoryDetail(currentRepairOrderId, source, historicalId);
    return detail ? { ok: true as const, detail } : { ok: false as const, message: "That Repair Order is not available in this history." };
  } catch {
    return { ok: false as const, message: "Repair Order details could not be loaded. Please try again." };
  }
}
