"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { optionalRepairOrderText } from "@/lib/repair-order-fields";

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
    (!displayName || displayName.length > 200 || phone.length > 40 ||
      email.length > 254 || (email && !/^\S+@\S+\.\S+$/.test(email)) ||
      addressLine1.length > 200 || city.length > 100 || state.length > 30 ||
      postalCode.length > 20 || vehicleMode !== "new")
  ) {
    redirect("/repair-orders/new?error=invalid-customer");
  }

  const year = Number(formData.get("year"));
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const licensePlate = String(formData.get("licensePlate") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim();
  const mileageValue = String(formData.get("mileage") ?? "").trim();
  const mileage = mileageValue ? Number(mileageValue) : null;
  const maximumYear = new Date().getFullYear() + 1;

  if (vehicleMode === "existing" && !UUID.test(existingVehicleId)) {
    redirect("/repair-orders/new?error=invalid-selection");
  }
  if (
    vehicleMode === "new" &&
    (!Number.isInteger(year) || year < 1886 || year > maximumYear ||
      !make || make.length > 100 || !model || model.length > 100 ||
      licensePlate.length > 30 || vin.length > 50 ||
      (mileage !== null && (!Number.isInteger(mileage) || mileage < 0 || mileage > 10_000_000)))
  ) {
    redirect("/repair-orders/new?error=invalid-vehicle");
  }
  if (vehicleMode !== "existing" && vehicleMode !== "new") {
    redirect("/repair-orders/new?error=invalid-selection");
  }

  const { user, membership } = await requirePermission("create_repair_order");

  if (customerMode === "existing") {
    const selection = await prisma.customer.findFirst({
      where: { id: existingCustomerId, shopId: membership.shopId },
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
          phone: phone || null,
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
      const vehicle = await transaction.vehicle.create({
        data: {
          shopId: membership.shopId,
          customerId,
          year,
          make,
          model,
          licensePlate: licensePlate || null,
          vin: vin || null,
          odometer: mileage,
        },
        select: { id: true },
      });
      vehicleId = vehicle.id;
    } else {
      const vehicle = await transaction.vehicle.findFirst({
        where: { id: existingVehicleId, customerId, shopId: membership.shopId },
        select: { id: true },
      });
      if (!vehicle) throw new Error("Invalid vehicle selection.");
    }

    const shop = await transaction.shop.update({
      where: { id: membership.shopId },
      data: { nextRepairOrderNumber: { increment: 1 } },
      select: { nextRepairOrderNumber: true },
    });
    const repairOrderNumber = shop.nextRepairOrderNumber - 1;

    const created = await transaction.repairOrder.create({
      data: {
        shopId: membership.shopId,
        customerId,
        vehicleId,
        repairOrderNumber,
        status: "draft",
        customerComplaint,
        recommendation,
      },
      select: { id: true },
    });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "repair_order_created", "repair_order", created.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `RO #${repairOrderNumber}`, entityHref: `/repair-orders/${created.id}`, contextSummary: "Repair order created" }) });
    return created;
  }, { isolationLevel: "Serializable" });

  revalidatePath("/repair-orders");
  redirect(`/repair-orders/${repairOrder.id}`);
}

export type RepairOrderSaveState = { status: "idle" | "success" | "error"; message?: string };

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
    await transaction.auditLog.create({
      data: auditEntry(
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
      ),
    });
  });

  revalidatePath(`/repair-orders/${repairOrderId}`);
  return { status: "success" };
}
