"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { calculateRepairOrderEstimateTotals } from "@/lib/invoice-lifecycle";
import { refreshRepairOrderTotals } from "@/lib/repair-order-totals";
import { auditEntry, writeAuditEntry } from "@/lib/audit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Prices are entered in dollars, limited to $10,000 per category for this initial workflow.
function cents(value: string) {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a valid dollar amount (up to $10,000).");
  const n = new Prisma.Decimal(value).mul(100);
  if (!n.isInteger() || n.lessThan(0) || n.greaterThan(1_000_000)) throw new Error("Out-the-door amount is out of range.");
  return n.toNumber();
}
function dollars(n: number) { return (n / 100).toFixed(2); }
type PricingContext = Awaited<ReturnType<typeof loadContext>>;

async function loadContext(tx: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  const [order, shop] = await Promise.all([
    tx.repairOrder.findFirst({
      where: { id: repairOrderId, shopId, status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } },
      select: {
        id: true, repairOrderNumber: true, shopSuppliesEnabledSnapshot: true,
        shopSuppliesRateSnapshot: true, shopSuppliesCapSnapshot: true, shopSuppliesTaxableSnapshot: true,
        parts: { select: { id: true, quantity: true, unitPrice: true } },
        labor: { where: { complimentary: false }, select: { id: true, hours: true, hourlyRate: true, shopSuppliesEligible: true } },
      },
    }),
    tx.shop.findUniqueOrThrow({ where: { id: shopId }, select: { defaultTaxRate: true, partsTaxable: true, laborTaxable: true } }),
  ]);
  if (!order) throw new Error("This repair order is no longer editable.");
  if (order.parts.length !== 1 || order.labor.length !== 1) throw new Error("Out-the-door pricing currently supports exactly one part and one paid labor line.");
  if (!order.parts[0].quantity.equals(1) || !order.labor[0].hours.equals(1)) {
    throw new Error("For this first version, set the part quantity and labor hours to 1 before using out-the-door pricing.");
  }
  return { order, shop };
}

function calculate(context: PricingContext, partCents: number, laborCents: number) {
  const { order, shop } = context;
  return calculateRepairOrderEstimateTotals({
    parts: [{ quantity: 1, unitPrice: dollars(partCents) }],
    labor: [{ hours: 1, hourlyRate: dollars(laborCents), shopSuppliesEligible: order.labor[0].shopSuppliesEligible }],
    shopSuppliesEnabled: order.shopSuppliesEnabledSnapshot,
    shopSuppliesRate: order.shopSuppliesRateSnapshot,
    shopSuppliesCap: order.shopSuppliesCapSnapshot,
    shopSuppliesTaxable: order.shopSuppliesTaxableSnapshot,
    taxRate: shop.defaultTaxRate,
    partsTaxable: shop.partsTaxable,
    laborTaxable: shop.laborTaxable,
  });
}

// Find a price in cents by evaluating the same calculator that persists RO totals.
// The monotone binary search avoids floating-point reverse-tax formulas.
function reverse(target: number, contributed: (value: number) => number): number {
  let low = 0, high = target;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const got = contributed(mid);
    if (got === target) return mid;
    if (got < target) low = mid + 1;
    else high = mid - 1;
  }
  throw new Error("The quoted amount cannot be matched exactly under the current tax and shop-supplies settings.");
}

function solve(context: PricingContext, partsTarget: number, laborTarget: number) {
  const zero = calculate(context, 0, 0);
  if (!zero.total.equals(0)) throw new Error("The current fee settings prevent an exact split.");
  const partAmount = reverse(partsTarget, (v) => Math.round(calculate(context, v, 0).total.toNumber() * 100));
  const laborAmount = reverse(laborTarget, (v) => Math.round(calculate(context, 0, v).total.toNumber() * 100));
  const result = calculate(context, partAmount, laborAmount);
  if (!result.total.equals(dollars(partsTarget + laborTarget))) {
    throw new Error("Combined tax rounding prevents an exact match. Please adjust the quoted amount by one cent or use regular line pricing.");
  }
  return {
    partsUnitPrice: dollars(partAmount),
    laborHourlyRate: dollars(laborAmount),
    partsTotal: result.partsTotal.toFixed(2),
    laborTotal: result.laborTotal.toFixed(2),
    shopSupplies: result.shopSuppliesAmount.toFixed(2),
    tax: result.taxTotal.toFixed(2),
    total: result.total.toFixed(2),
    currentPartPrice: context.order.parts[0].unitPrice.toFixed(2),
    currentLaborRate: context.order.labor[0].hourlyRate.toFixed(2),
  };
}

export type OutTheDoorPreview = ReturnType<typeof solve>;
export async function previewOutTheDoorPricing(repairOrderId: string, partsQuoted: string, laborQuoted: string) {
  try {
    const { membership } = await requirePermission("edit_draft_repair_order");
    const partsTarget = cents(partsQuoted), laborTarget = cents(laborQuoted);
    const context = await loadContext(prisma, membership.shopId, repairOrderId);
    return { ok: true as const, preview: solve(context, partsTarget, laborTarget) };
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : "Unable to calculate the quote." };
  }
}

export async function applyOutTheDoorPricing(repairOrderId: string, partsQuoted: string, laborQuoted: string, approved: OutTheDoorPreview) {
  try {
    const { user, membership } = await requirePermission("edit_draft_repair_order");
    const partsTarget = cents(partsQuoted), laborTarget = cents(laborQuoted);
    await prisma.$transaction(async (tx) => {
      const context = await loadContext(tx, membership.shopId, repairOrderId);
      const now = solve(context, partsTarget, laborTarget);
      if (JSON.stringify(now) !== JSON.stringify(approved)) throw new Error("The RO changed since the preview. Calculate again before applying.");
      const part = context.order.parts[0], labor = context.order.labor[0];
      await tx.repairOrderPart.updateMany({ where: { id: part.id, repairOrderId, shopId: membership.shopId }, data: { unitPrice: now.partsUnitPrice } });
      await tx.repairOrderLabor.updateMany({ where: { id: labor.id, repairOrderId, shopId: membership.shopId }, data: { hourlyRate: now.laborHourlyRate } });
      await refreshRepairOrderTotals(tx, membership.shopId, repairOrderId);
      const persisted = await tx.repairOrder.findUniqueOrThrow({ where: { id: repairOrderId }, select: { estimatedTotal: true } });
      if (!persisted.estimatedTotal.equals(now.total)) throw new Error("Final RO total did not match the approved quote. No changes were saved.");
      await writeAuditEntry(tx, auditEntry(membership.shopId, user?.id, "out_the_door_pricing_applied", "repair_order", repairOrderId,
        { partsQuoted, laborQuoted, applied: now },
        { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${context.order.repairOrderNumber}`, entityHref: `/repair-orders/${repairOrderId}`, contextSummary: "Out-the-door quote applied" }),
        { category: "operational", enabled: membership.shop.auditLoggingEnabled });
    });
    revalidatePath(`/repair-orders/${repairOrderId}`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : "Unable to apply the quote." };
  }
}
