"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { captureQueryPerformanceSample } from "@/lib/system-health/query-performance";

export async function captureSystemHealthQuerySnapshot() {
  await requirePermission("edit_shop_settings");
  try {
    await captureQueryPerformanceSample();
  } catch {
    // No secrets or raw SQL errors go to the UI. Unavailable state is visible in the dashboard.
  }
  revalidatePath("/admin/system-health");
}
