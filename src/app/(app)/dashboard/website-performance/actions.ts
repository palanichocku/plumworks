"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

const allowed: Record<string, readonly string[]> = {
  GBP: ["views", "interactions", "calls", "directions", "websiteClicks", "bookings"],
  GSC: ["clicks", "impressions", "ctr", "averagePosition"],
};
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function parsedDate(raw: string) {
  if (!datePattern.test(raw)) throw new Error("Invalid date.");
  const date = new Date(raw + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) throw new Error("Invalid date.");
  return date;
}
function fullCompletedMonth(start: Date, end: Date, today: Date) {
  if (start.getUTCDate() !== 1 || end.getUTCDate() !== new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()) return false;
  if (start.getUTCFullYear() !== end.getUTCFullYear() || start.getUTCMonth() !== end.getUTCMonth()) return false;
  return end.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
}
export async function saveMarketingSnapshot(formData: FormData) {
  // Never allow a public form, staff member, or monitor account to import statistics.
  const { membership } = await requirePermission("edit_shop_settings");
  if (!["OWNER", "ADMIN"].includes(membership.role)) throw new Error("Reporting import requires owner/admin access.");
  const source = String(formData.get("source") ?? "");
  if (!Object.prototype.hasOwnProperty.call(allowed, source)) throw new Error("Invalid marketing source.");
  const start = parsedDate(String(formData.get("periodStart") ?? ""));
  const end = parsedDate(String(formData.get("periodEnd") ?? ""));
  const today = new Date();
  if (end < start || end.getTime() - start.getTime() > 366 * 86400000 || end > today) throw new Error("Invalid reporting range.");

  const metrics: Record<string, number> = {};
  for (const key of allowed[source]) {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) continue; // Missing is unknown; never silently assume zero.
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) throw new Error("Invalid metric: " + key);
    if (key === "ctr" && number > 100) throw new Error("CTR must be a percentage.");
    if (!["ctr", "averagePosition"].includes(key) && !Number.isInteger(number)) throw new Error("Counts must be whole numbers.");
    metrics[key] = number;
  }
  if (!Object.keys(metrics).length) throw new Error("Provide at least one measurement.");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;
  const partial = !fullCompletedMonth(start, end, today);
  await prisma.marketingPerformanceSnapshot.upsert({
    where: { shopId_source_periodStart_periodEnd: { shopId: membership.shopId, source, periodStart: start, periodEnd: end } },
    create: { shopId: membership.shopId, source, periodStart: start, periodEnd: end, metrics, notes, partial },
    update: { metrics, notes, partial, recordedAt: new Date() },
  });
  revalidatePath("/dashboard/website-performance");
  redirect("/dashboard/website-performance?saved=1");
}
