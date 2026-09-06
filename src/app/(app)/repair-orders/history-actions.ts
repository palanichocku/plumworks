"use server";

import { getCustomerRepairOrderHistory, getCustomerRepairOrderHistoryDetail, type RepairOrderHistoryCursor } from "@/lib/data/repair-order-history";

export async function loadRepairOrderHistory(customerId: string, currentRepairOrderId?: string, cursor?: RepairOrderHistoryCursor | null) {
  try {
    const result = await getCustomerRepairOrderHistory(customerId, currentRepairOrderId, cursor);
    return result ? { ok: true as const, ...result } : { ok: false as const, message: "Repair Order history is unavailable." };
  } catch {
    return { ok: false as const, message: "Repair Order history could not be loaded. Please try again." };
  }
}

export async function loadRepairOrderHistoryDetail(customerId: string, currentRepairOrderId: string | undefined, source: unknown, historicalId: string) {
  try {
    const detail = await getCustomerRepairOrderHistoryDetail(customerId, currentRepairOrderId, source, historicalId);
    return detail ? { ok: true as const, detail } : { ok: false as const, message: "That Repair Order is not available in this history." };
  } catch {
    return { ok: false as const, message: "Repair Order details could not be loaded. Please try again." };
  }
}
