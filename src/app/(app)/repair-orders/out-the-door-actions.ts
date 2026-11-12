"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { calculateRepairOrderEstimateTotals } from "@/lib/invoice-lifecycle";
import { refreshRepairOrderTotals } from "@/lib/repair-order-totals";
import { auditEntry, writeAuditEntry } from "@/lib/audit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type QuotedLine = { kind: "part" | "labor"; description: string; quotedPrice: string };
export type QuotedLinePreview = { kind: "part" | "labor"; description: string; quotedPrice: string; priceBeforeFees: string };
export type OutTheDoorPreview = {
  lines: QuotedLinePreview[]; partsTotal: string; laborTotal: string;
  shopSupplies: string; tax: string; total: string; partsQuoted: string; laborQuoted: string;
};
function cents(raw: string) {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(raw.trim())) throw new Error("Enter amounts in dollars with up to two decimals.");
  const value = new Prisma.Decimal(raw).mul(100);
  if (!value.isInteger() || value.lessThan(0) || value.greaterThan(1_000_000)) throw new Error("Each amount must be between $0 and $10,000.");
  return value.toNumber();
}
function dollars(value: number) { return (value / 100).toFixed(2); }
function validateLines(lines: QuotedLine[]) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 30) throw new Error("Enter between 1 and 30 parts or labor items.");
  const normalized = lines.map((line) => {
    if (!line || (line.kind !== "part" && line.kind !== "labor")) throw new Error("Invalid item type.");
    const description = String(line.description ?? "").trim() || (line.kind === "part" ? "PART DESCRIPTION PENDING" : "LABOR DESCRIPTION PENDING");
    if (description.length > 500) throw new Error("Description must be 500 characters or less.");
    return { kind: line.kind, description, quotedPrice: dollars(cents(String(line.quotedPrice ?? ""))) };
  });
  if (!normalized.some(line => cents(line.quotedPrice) > 0)) throw new Error("Enter at least one amount greater than zero.");
  return normalized;
}

async function context(tx: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  const [order, shop] = await Promise.all([
    tx.repairOrder.findFirst({
      where: { id: repairOrderId, shopId, status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } },
      select: { id: true, repairOrderNumber: true, shopSuppliesEnabledSnapshot: true, shopSuppliesRateSnapshot: true,
        shopSuppliesCapSnapshot: true, shopSuppliesTaxableSnapshot: true,
        parts: { select: { id: true } },
        labor: { select: { id: true } } },
    }),
    tx.shop.findUniqueOrThrow({ where: { id: shopId }, select: { defaultTaxRate: true, partsTaxable: true, laborTaxable: true } }),
  ]);
  if (!order) throw new Error("This RO is not editable.");
  // Do not silently replace existing line items or interfere with complimentary work.
  if (order.parts.length || order.labor.length) throw new Error("This quick-entry form is for an RO with no existing parts or labor. Use regular line editing for an RO that already has items.");
  return { order, shop };
}
type Context = Awaited<ReturnType<typeof context>>;

// Every generated paid labor line is eligible for shop supplies. Existing tax/fee
// settings are reused exactly, including caps and the taxable-supplies rule.
function totals(ctx: Context, partCents: number, laborCents: number) {
  const { order, shop } = ctx;
  return calculateRepairOrderEstimateTotals({
    parts: [{ quantity: 1, unitPrice: dollars(partCents) }],
    labor: [{ hours: 1, hourlyRate: dollars(laborCents), shopSuppliesEligible: true }],
    shopSuppliesEnabled: order.shopSuppliesEnabledSnapshot,
    shopSuppliesRate: order.shopSuppliesRateSnapshot,
    shopSuppliesCap: order.shopSuppliesCapSnapshot,
    shopSuppliesTaxable: order.shopSuppliesTaxableSnapshot,
    taxRate: shop.defaultTaxRate, partsTaxable: shop.partsTaxable, laborTaxable: shop.laborTaxable,
  });
}
function reverse(target: number, valueFor: (amount: number) => number) {
  let low = 0, high = target, match: number | null = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2), value = valueFor(mid);
    if (value === target) { match = mid; break; }
    if (value < target) low = mid + 1; else high = mid - 1;
  }
  if (match === null) throw new Error("The quoted amount cannot be matched exactly with the current tax and shop supplies settings.");
  return match;
}
function allocate(weights: number[], total: number) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map(w => w * total / sum);
  const base = raw.map(Math.floor);
  const leftovers = total - base.reduce((a, b) => a + b, 0);
  const indices = weights.map((_, i) => i).sort((a, b) => (raw[b] - base[b]) - (raw[a] - base[a]) || a - b);
  for (let i = 0; i < leftovers; i++) base[indices[i]]++;
  return base;
}
function solve(ctx: Context, input: QuotedLine[]): OutTheDoorPreview {
  const lines = validateLines(input);
  const partTarget = lines.filter(x => x.kind === "part").reduce((n,x)=>n+cents(x.quotedPrice),0);
  const laborTarget = lines.filter(x => x.kind === "labor").reduce((n,x)=>n+cents(x.quotedPrice),0);
  const partNet = reverse(partTarget, p => totals(ctx,p,0).total.mul(100).toNumber());
  const laborNet = reverse(laborTarget, l => totals(ctx,0,l).total.mul(100).toNumber());
  const result = totals(ctx,partNet,laborNet);
  if (!result.total.equals(dollars(partTarget+laborTarget))) {
    throw new Error("Combined rounding prevents an exact match. Adjust a quoted item by one cent or use regular line pricing.");
  }
  const partWeights = lines.filter(x => x.kind === "part").map(x=>cents(x.quotedPrice));
  const laborWeights = lines.filter(x => x.kind === "labor").map(x=>cents(x.quotedPrice));
  const partValues = allocate(partWeights,partNet), laborValues = allocate(laborWeights,laborNet);
  let p=0,l=0;
  const output = lines.map(x=>({ ...x, priceBeforeFees: dollars(x.kind === "part" ? partValues[p++] : laborValues[l++]) }));
  return { lines:output, partsTotal:result.partsTotal.toFixed(2), laborTotal:result.laborTotal.toFixed(2),
    shopSupplies:result.shopSuppliesAmount.toFixed(2), tax:result.taxTotal.toFixed(2),
    total:result.total.toFixed(2), partsQuoted:dollars(partTarget), laborQuoted:dollars(laborTarget) };
}

export async function previewOutTheDoorPricing(repairOrderId: string, lines: QuotedLine[]) {
  try {
    const { membership } = await requirePermission("edit_draft_repair_order");
    const ctx = await context(prisma, membership.shopId, repairOrderId);
    return { ok: true as const, preview: solve(ctx,lines) };
  } catch (err) {
    return { ok:false as const, message: err instanceof Error ? err.message : "Unable to calculate the quote." };
  }
}
export async function applyOutTheDoorPricing(repairOrderId: string, lines: QuotedLine[], approved: OutTheDoorPreview) {
  try {
    const { user, membership } = await requirePermission("edit_draft_repair_order");
    await prisma.$transaction(async tx => {
      const ctx = await context(tx,membership.shopId,repairOrderId);
      const current = solve(ctx,lines);
      if (JSON.stringify(current) !== JSON.stringify(approved)) throw new Error("The quote changed. Review the calculation again before applying.");
      for (const line of current.lines) {
        if (line.kind === "part") {
          await tx.repairOrderPart.create({
            data: { shopId:membership.shopId,repairOrderId, description:line.description,quantity:"1.00",
              unitPrice:line.priceBeforeFees,legacyLineKey:`web:${randomUUID()}` },
          });
        } else {
          await tx.repairOrderLabor.create({
            data: { shopId:membership.shopId,repairOrderId,description:line.description,hours:"1.00",
              hourlyRate:line.priceBeforeFees,shopSuppliesEligible:true,complimentary:false,
              legacyLineKey:`web:${randomUUID()}` },
          });
        }
      }
      await refreshRepairOrderTotals(tx,membership.shopId,repairOrderId);
      const persisted=await tx.repairOrder.findUniqueOrThrow({where:{id:repairOrderId},select:{estimatedTotal:true}});
      if (!persisted.estimatedTotal.equals(current.total)) throw new Error("Calculated RO total differs from the quote. No lines were saved.");
      await writeAuditEntry(tx,auditEntry(membership.shopId,user?.id,"out_the_door_pricing_applied","repair_order",repairOrderId,
        {quotedLines:lines,calculated:current},
        {actorEmail:user?.email,actorRole:membership.role,entityLabel:`RO #${ctx.order.repairOrderNumber}`,
          entityHref:`/repair-orders/${repairOrderId}`,contextSummary:"Out-the-door quote created RO lines"}),
        {category:"operational",enabled:membership.shop.auditLoggingEnabled});
    });
    revalidatePath(`/repair-orders/${repairOrderId}`);
    return { ok:true as const };
  } catch (err) {
    return { ok:false as const,message:err instanceof Error ? err.message : "Unable to save the quote." };
  }
}
