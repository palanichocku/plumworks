"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { refreshRepairOrderTotals } from "@/lib/repair-order-totals";
import { cleanVendorName, MAX_VENDOR_NAME_LENGTH, validatedVendorName } from "@/lib/vendors";
import type { PartActionState } from "@/components/part-action-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function partValues(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  const quantity = Number(formData.get("quantity"));
  const unitPrice = Number(formData.get("unitPrice"));
  if (
    !description || description.length > 500 || !Number.isFinite(quantity) ||
    quantity <= 0 || quantity > 1_000_000 || !Number.isFinite(unitPrice) ||
    unitPrice < 0 || unitPrice > 1_000_000
  ) {
    throw new Error("Invalid part line.");
  }
  return {
    description,
    quantity: quantity.toFixed(2),
    unitPrice: unitPrice.toFixed(2),
  };
}

async function editableOrder(shopId: string, repairOrderId: string) {
  if (!UUID.test(repairOrderId)) throw new Error("Invalid repair order.");
  const order = await prisma.repairOrder.findFirst({
    where: {
      id: repairOrderId,
      shopId,
      status: { in: ["draft", "open"] },
      legacySourceTable: null,
      invoices: { none: {} },
    },
    select: { id: true, repairOrderNumber: true },
  });
  if (!order) throw new Error("Repair order is not editable.");
  return order;
}

async function vendorValues(
  transaction: Prisma.TransactionClient,
  shopId: string,
  formData: FormData,
) {
  const vendorId = String(formData.get("vendorId") ?? "");
  const newVendorName = String(formData.get("newVendorName") ?? "");
  const vendorInput = cleanVendorName(String(formData.get("vendorInput") ?? ""));
  if (vendorId && newVendorName) throw new Error("Select either an existing Vendor or a new Vendor.");

  if (vendorId) {
    if (!UUID.test(vendorId)) throw new Error("Invalid Vendor selection.");
    const vendor = await transaction.vendor.findFirst({
      where: { id: vendorId, shopId },
      select: { id: true, name: true },
    });
    if (!vendor) throw new Error("That Vendor is not available for this shop.");
    return { vendorId: vendor.id, vendorNameSnapshot: vendor.name };
  }

  if (newVendorName) {
    const vendorName = validatedVendorName(newVendorName);
    const vendor = await transaction.vendor.upsert({
      where: { shopId_normalizedName: { shopId, normalizedName: vendorName.normalizedName } },
      update: {},
      create: { shopId, ...vendorName },
      select: { id: true, name: true },
    });
    return { vendorId: vendor.id, vendorNameSnapshot: vendor.name };
  }

  if (vendorInput.length > MAX_VENDOR_NAME_LENGTH) {
    throw new Error(`Vendor name must be ${MAX_VENDOR_NAME_LENGTH} characters or fewer.`);
  }
  if (vendorInput) throw new Error("Select a Vendor or choose the Add Vendor option.");
  return { vendorId: null, vendorNameSnapshot: null };
}

export async function addPartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const values = partValues(formData);
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const order = await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const vendor = await vendorValues(transaction, membership.shopId, formData);
    const line = await transaction.repairOrderPart.create({
      data: {
        shopId: membership.shopId,
        repairOrderId,
        ...values,
        ...vendor,
        legacyLineKey: `web:${randomUUID()}`,
      },
      select: { id: true },
    });
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "part_line_added", "repair_order_part", line.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${repairOrderId}`, contextSummary: "Part line added" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function updatePartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const partLineId = String(formData.get("partLineId") ?? "");
  const values = partValues(formData);
  if (!UUID.test(partLineId)) throw new Error("Invalid part line.");
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const order = await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const vendor = await vendorValues(transaction, membership.shopId, formData);
    const result = await transaction.repairOrderPart.updateMany({
      where: { id: partLineId, repairOrderId, shopId: membership.shopId },
      data: { ...values, ...vendor },
    });
    if (result.count !== 1) throw new Error("Part line is not editable.");
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "part_line_updated", "repair_order_part", partLineId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${repairOrderId}`, contextSummary: "Part line updated" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

export async function deletePartLine(formData: FormData) {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const partLineId = String(formData.get("partLineId") ?? "");
  if (!UUID.test(partLineId)) throw new Error("Invalid part line.");
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const order = await editableOrder(membership.shopId, repairOrderId);

  await prisma.$transaction(async (transaction) => {
    const result = await transaction.repairOrderPart.deleteMany({
      where: { id: partLineId, repairOrderId, shopId: membership.shopId },
    });
    if (result.count !== 1) throw new Error("Part line is not editable.");
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "part_line_deleted", "repair_order_part", partLineId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${repairOrderId}`, contextSummary: "Part line deleted" }) });
  });
  revalidatePath(`/repair-orders/${repairOrderId}`);
}

function partActionError(error: unknown) {
  if (error instanceof Error && (
    error.message.startsWith("Vendor") || error.message.startsWith("Enter a Vendor") ||
    error.message.startsWith("Invalid Vendor") || error.message.startsWith("That Vendor") ||
    error.message.startsWith("Select a Vendor") || error.message.startsWith("Select either")
  )) return error.message;
  return "The part could not be saved. Check the values and try again.";
}

export async function addPartLineWithState(_state: PartActionState, formData: FormData): Promise<PartActionState> {
  try {
    await addPartLine(formData);
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: partActionError(error) };
  }
}

export async function updatePartLineWithState(_state: PartActionState, formData: FormData): Promise<PartActionState> {
  try {
    await updatePartLine(formData);
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: partActionError(error) };
  }
}
