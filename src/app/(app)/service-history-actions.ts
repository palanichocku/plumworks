"use server";

import { getServiceHistoryDetail } from "@/lib/data/repair-order-history";

export async function loadServiceHistoryDetail(context: unknown, contextId: string, source: unknown, historicalId: string) {
  try {
    const detail = await getServiceHistoryDetail(context, contextId, source, historicalId);
    return detail
      ? { ok: true as const, detail }
      : { ok: false as const, message: "That service record is not available in this history." };
  } catch {
    return { ok: false as const, message: "Service details could not be loaded. Please try again." };
  }
}
