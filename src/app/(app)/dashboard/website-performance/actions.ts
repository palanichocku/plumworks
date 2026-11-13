"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseGooglePerformanceFile, type ParsedGoogleReport } from "@/lib/google-performance-import";

async function googleReportAccess() {
  const { membership } = await requirePermission("edit_shop_settings");
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") throw new Error("Owner or Admin permission required.");
  return membership;
}
async function validatedFile(form: FormData) {
  const file = form.get("report");
  if (!(file instanceof File)) throw new Error("Select an original Google CSV or ZIP report.");
  if (file.size > 3_000_000 || file.size === 0) throw new Error("Report must be smaller than 3 MB.");
  const report = parseGooglePerformanceFile(file.name, Buffer.from(await file.arrayBuffer()));
  if (report.source === "GBP" && report.businessName?.toLowerCase() !== "car doc") {
    throw new Error("This Business Profile report is not identified as Car Doc.");
  }
  return report;
}
export type GoogleImportPreview = {
  report: ParsedGoogleReport;
  duplicates: string[];
  overlaps: string[];
};
export async function previewGooglePerformanceImport(form: FormData): Promise<GoogleImportPreview> {
  const membership = await googleReportAccess();
  const report = await validatedFile(form);
  const existing = await prisma.marketingPerformanceSnapshot.findMany({
    where: { shopId: membership.shopId, source: report.source },
    select: { periodStart: true, periodEnd: true },
  });
  const periods = report.snapshots.map((row) => row.periodStart + " to " + row.periodEnd);
  const duplicates: string[] = [], overlaps: string[] = [];
  for (let i = 0; i < report.snapshots.length; i++) {
    const row = report.snapshots[i], label = periods[i];
    const duplicatesPeriod = existing.some((x) => x.periodStart.toISOString().slice(0,10) === row.periodStart && x.periodEnd.toISOString().slice(0,10) === row.periodEnd);
    if (duplicatesPeriod) duplicates.push(label);
    else if (existing.some((x) => x.periodStart.toISOString().slice(0,10) <= row.periodEnd && x.periodEnd.toISOString().slice(0,10) >= row.periodStart)) overlaps.push(label);
  }
  return { report, duplicates, overlaps };
}
export async function confirmGooglePerformanceImport(form: FormData): Promise<{ imported: number; replaced: number }> {
  const membership = await googleReportAccess();
  const { report, duplicates, overlaps } = await previewGooglePerformanceImport(form);
  if (overlaps.length && form.get("ackOverlaps") !== "yes") throw new Error("Acknowledge the overlapping historical reporting periods.");
  if (duplicates.length && form.get("replace") !== "yes") throw new Error("Some exact reporting periods already exist. Confirm replacement before importing.");
  // Revalidate each row at persistence, allowing bounded, verified source data only.
  await prisma.$transaction(report.snapshots.map((row) => prisma.marketingPerformanceSnapshot.upsert({
    where: { shopId_source_periodStart_periodEnd: {
      shopId: membership.shopId, source: row.source,
      periodStart: new Date(row.periodStart + "T00:00:00.000Z"), periodEnd: new Date(row.periodEnd + "T00:00:00.000Z") } },
    create: { shopId: membership.shopId, source: row.source,
      periodStart: new Date(row.periodStart + "T00:00:00.000Z"), periodEnd: new Date(row.periodEnd + "T00:00:00.000Z"),
      metrics: row.metrics, partial: row.partial, notes: row.notes },
    update: { metrics: row.metrics, partial: row.partial, notes: row.notes, recordedAt: new Date() },
  })));
  revalidatePath("/dashboard/website-performance");
  return { imported: report.snapshots.length, replaced: duplicates.length };
}

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
