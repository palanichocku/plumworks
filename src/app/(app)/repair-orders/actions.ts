"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { optionalRepairOrderText } from "@/lib/repair-order-fields";
import { refreshRepairOrderTotals } from "@/lib/repair-order-totals";
import { customerPhoneForStorage } from "@/lib/customer-phone";
import { vehicleEngineForStorage } from "@/lib/vehicle-fields";
import { repairOrderMileageForStorage } from "@/lib/repair-order-mileage";
import { operationalRepairOrderWhere } from "@/lib/repair-order-lifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createRepairOrder(formData: FormData) {
  const customerMode = String(formData.get("customerMode") ?? "existing");
  const existingCustomerId = String(formData.get("customerId") ?? "");
  const vehicleMode = String(formData.get("vehicleMode") ?? "existing");
  const existingVehicleId = String(formData.get("vehicleId") ?? "");
  if (customerMode !== "existing" && customerMode !== "new") {
    redirect("/repair-orders/new?error=invalid-selection");
  }

  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const storedPhone = customerPhoneForStorage(phone);
  const phone2 = String(formData.get("phone2") ?? "").trim();
  const storedPhone2 = customerPhoneForStorage(phone2);
  const email = String(formData.get("email") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  const customerComplaint = optionalRepairOrderText(formData.get("customerComplaint"));
  const recommendation = optionalRepairOrderText(formData.get("recommendation"));

  if (customerMode === "existing" && !UUID.test(existingCustomerId)) {
    redirect("/repair-orders/new?error=invalid-selection");
  }
  if (
    customerMode === "new" &&
    (!displayName || displayName.length > 200 || storedPhone === undefined || storedPhone2 === undefined ||
      email.length > 254 || (email && !/^\S+@\S+\.\S+$/.test(email)) ||
      addressLine1.length > 200 || city.length > 100 || state.length > 30 ||
      postalCode.length > 20 || vehicleMode !== "new")
  ) {
    redirect("/repair-orders/new?error=invalid-customer");
  }

  const year = Number(formData.get("year"));
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const engine = vehicleEngineForStorage(formData.get("engine"));
  const licensePlate = String(formData.get("licensePlate") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim();
  const mileage = repairOrderMileageForStorage(formData.get("mileage"));
  const maximumYear = new Date().getFullYear() + 1;

  if (mileage === undefined) {
    redirect("/repair-orders/new?error=invalid-vehicle");
  }

  if (vehicleMode === "existing" && !UUID.test(existingVehicleId)) {
    redirect("/repair-orders/new?error=invalid-selection");
  }
  if (
    vehicleMode === "new" &&
    (!Number.isInteger(year) || year < 1886 || year > maximumYear ||
      !make || make.length > 100 || !model || model.length > 100 || engine === undefined ||
      licensePlate.length > 30 || vin.length > 50)
  ) {
    redirect("/repair-orders/new?error=invalid-vehicle");
  }
  if (vehicleMode !== "existing" && vehicleMode !== "new") {
    redirect("/repair-orders/new?error=invalid-selection");
  }

  const { user, membership } = await requirePermission("create_repair_order");

  if (customerMode === "existing") {
    const selection = await prisma.customer.findFirst({
      where: { id: existingCustomerId, shopId: membership.shopId, archivedAt: null },
      select: { id: true },
    });
    if (!selection) redirect("/repair-orders/new?error=invalid-selection");
  }

  const repairOrder = await prisma.$transaction(async (transaction) => {
    let customerId = existingCustomerId;
    if (customerMode === "new") {
      const customer = await transaction.customer.create({
        data: {
          shopId: membership.shopId,
          displayName,
          phone: storedPhone,
          phone2: storedPhone2,
          email: email || null,
          addressLine1: addressLine1 || null,
          city: city || null,
          state: state || null,
          postalCode: postalCode || null,
        },
        select: { id: true },
      });
      customerId = customer.id;
    }

    let vehicleId = existingVehicleId;
    if (vehicleMode === "new") {
      if (vin) {
        const conflict = await transaction.vehicle.findFirst({
          where: { shopId: membership.shopId, vin: { equals: vin, mode: "insensitive" } },
          select: { archivedAt: true, customer: { select: { archivedAt: true } } },
        });
        if (conflict) throw new Error(conflict.archivedAt || conflict.customer.archivedAt ? "An archived vehicle already uses this VIN. Restore that vehicle instead." : "A vehicle already uses this VIN.");
      }
      const vehicle = await transaction.vehicle.create({
        data: {
          shopId: membership.shopId,
          customerId,
          year,
          make,
          model,
          engine,
          licensePlate: licensePlate || null,
          vin: vin || null,
          odometer: mileage,
        },
        select: { id: true },
      });
      vehicleId = vehicle.id;
    } else {
      const vehicle = await transaction.vehicle.findFirst({
        where: { id: existingVehicleId, customerId, shopId: membership.shopId, archivedAt: null, customer: { archivedAt: null } },
        select: { id: true },
      });
      if (!vehicle) throw new Error("Invalid vehicle selection.");
    }

    const shop = await transaction.shop.update({
      where: { id: membership.shopId },
      data: { nextRepairOrderNumber: { increment: 1 } },
      select: { nextRepairOrderNumber: true, shopSuppliesEnabled: true, shopSuppliesRate: true, shopSuppliesCap: true, shopSuppliesTaxable: true },
    });
    const repairOrderNumber = shop.nextRepairOrderNumber - 1;

    const created = await transaction.repairOrder.create({
      data: {
        shopId: membership.shopId,
        customerId,
        vehicleId,
        repairOrderNumber,
        status: "draft",
        odometer: mileage,
        customerComplaint,
        recommendation,
        shopSuppliesEnabledSnapshot: shop.shopSuppliesEnabled,
        shopSuppliesRateSnapshot: shop.shopSuppliesRate,
        shopSuppliesCapSnapshot: shop.shopSuppliesCap,
        shopSuppliesTaxableSnapshot: shop.shopSuppliesTaxable,
      },
      select: { id: true },
    });
    await refreshRepairOrderTotals(transaction, membership.shopId, created.id);
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "repair_order_created", "repair_order", created.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${repairOrderNumber}`, entityHref: `/repair-orders/${created.id}`, contextSummary: "Repair order created" }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
    return created;
  }, { isolationLevel: "Serializable" });

  revalidatePath("/repair-orders");
  redirect(`/repair-orders/${repairOrder.id}`);
}

export type RepairOrderSaveState = { status: "idle" | "success" | "error"; message?: string };

export async function updateRepairOrderMileage(_previousState: RepairOrderSaveState, formData: FormData): Promise<RepairOrderSaveState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const odometer = repairOrderMileageForStorage(formData.get("mileage"));
  if (!UUID.test(repairOrderId) || odometer === undefined) return { status: "error", message: "Enter a valid current mileage." };
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM repair_orders WHERE id = ${repairOrderId}::uuid AND shop_id = ${membership.shopId}::uuid FOR UPDATE`;
    const order = await transaction.repairOrder.findFirst({
      where: { id: repairOrderId, ...operationalRepairOrderWhere(membership.shopId) },
      select: { id: true, repairOrderNumber: true, odometer: true },
    });
    if (!order) return false;
    await transaction.repairOrder.update({ where: { id: order.id }, data: { odometer } });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "repair_order_mileage_updated", "repair_order", order.id, { from: order.odometer, to: odometer }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${order.repairOrderNumber}`, entityHref: `/repair-orders/${order.id}`, contextSummary: "Repair order current mileage updated" }), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
    return true;
  }, { isolationLevel: "Serializable" });
  if (!updated) return { status: "error", message: "This Repair Order is no longer editable." };
  revalidatePath(`/repair-orders/${repairOrderId}`);
  return { status: "success", message: "Current mileage updated." };
}

export async function updateRepairOrderConcerns(_previousState: RepairOrderSaveState, formData: FormData): Promise<RepairOrderSaveState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  if (!UUID.test(repairOrderId)) return { status: "error", message: "Unable to save this repair order." };

  const customerComplaint = optionalRepairOrderText(formData.get("customerComplaint"));
  const recommendation = optionalRepairOrderText(formData.get("recommendation"));
  const { user, membership } = await requirePermission("edit_draft_repair_order");
  const existing = await prisma.repairOrder.findFirst({
    where: {
      id: repairOrderId,
      shopId: membership.shopId,
      legacySourceTable: null,
      status: { in: ["draft", "open"] },
    },
    select: { id: true, repairOrderNumber: true },
  });
  if (!existing) return { status: "error", message: "This repair order is no longer editable." };

  await prisma.$transaction(async (transaction) => {
    await transaction.repairOrder.update({
      where: { id: repairOrderId },
      data: { customerComplaint, recommendation },
    });
    await refreshRepairOrderTotals(transaction, membership.shopId, repairOrderId);
    await writeAuditEntry(transaction, auditEntry(
        membership.shopId,
        user?.id,
        "repair_order_concerns_updated",
        "repair_order",
        repairOrderId,
        { fields: ["customerComplaint", "recommendation"] },
        {
          actorEmail: user?.email,
          actorRole: membership.role,
          entityLabel: `RO #${existing.repairOrderNumber}`,
          entityHref: `/repair-orders/${repairOrderId}`,
          contextSummary: "Customer concerns and recommendations updated",
        },
      ), { category: "operational", enabled: membership.shop.auditLoggingEnabled });
  });

  revalidatePath(`/repair-orders/${repairOrderId}`);
  return { status: "success" };
}
