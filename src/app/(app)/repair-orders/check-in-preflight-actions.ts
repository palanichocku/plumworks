"use server";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { customerPhoneForStorage } from "@/lib/customer-phone";
import { customerDisplayName } from "@/lib/customer-name";

export type RepairOrderCheckInPreflightResult = {
  vehicleConflict: null | {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    vin: string;
    licensePlate: string | null;
    archived: boolean;
    customer: { id: string; displayName: string; phone: string | null; email: string | null; archived: boolean };
  };
  customerMatches: Array<{
    id: string;
    displayName: string;
    phone: string | null;
    email: string | null;
    reasons: string[];
  }>;
};

function normalizedEmail(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().toLowerCase();
}

export async function preflightRepairOrderCheckIn(formData: FormData): Promise<RepairOrderCheckInPreflightResult> {
  const { membership } = await requirePermission("create_repair_order");
  const customerMode = String(formData.get("customerMode") ?? "existing");
  const vehicleMode = String(formData.get("vehicleMode") ?? "existing");
  const vin = String(formData.get("vin") ?? "").trim();

  let vehicleConflict: RepairOrderCheckInPreflightResult["vehicleConflict"] = null;
  if (vehicleMode === "new" && vin) {
    const conflict = await prisma.vehicle.findFirst({
      where: { shopId: membership.shopId, vin: { equals: vin, mode: "insensitive" } },
      select: {
        id: true,
        year: true,
        make: true,
        model: true,
        vin: true,
        licensePlate: true,
        archivedAt: true,
        customer: { select: { id: true, displayName: true, phone: true, email: true, archivedAt: true } },
      },
    });
    if (conflict?.vin) {
      vehicleConflict = {
        id: conflict.id,
        year: conflict.year,
        make: conflict.make,
        model: conflict.model,
        vin: conflict.vin,
        licensePlate: conflict.licensePlate,
        archived: Boolean(conflict.archivedAt),
        customer: {
          id: conflict.customer.id,
          displayName: conflict.customer.displayName,
          phone: conflict.customer.phone,
          email: conflict.customer.email,
          archived: Boolean(conflict.customer.archivedAt),
        },
      };
    }
  }

  const customerMatches: RepairOrderCheckInPreflightResult["customerMatches"] = [];
  if (customerMode === "new") {
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const displayName = customerDisplayName(firstName, lastName);
    const phone = customerPhoneForStorage(String(formData.get("phone") ?? "").trim());
    const email = normalizedEmail(formData.get("email"));

    const or: Prisma.CustomerWhereInput[] = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email: { equals: email, mode: "insensitive" } });
    if (displayName && (phone || email)) or.push({ displayName: { equals: displayName, mode: "insensitive" } });

    if (or.length) {
      const candidates = await prisma.customer.findMany({
        where: { shopId: membership.shopId, archivedAt: null, OR: or },
        select: { id: true, displayName: true, phone: true, email: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      });
      for (const candidate of candidates) {
        const reasons: string[] = [];
        const sameName = Boolean(displayName && candidate.displayName.trim().toLowerCase() === displayName.toLowerCase());
        const samePhone = Boolean(phone && candidate.phone === phone);
        const sameEmail = Boolean(email && candidate.email?.trim().toLowerCase() === email);
        if (samePhone) reasons.push("same phone");
        if (sameEmail) reasons.push("same email");
        if (sameName && (samePhone || sameEmail)) reasons.push("same name");
        if (samePhone || sameEmail) customerMatches.push({ ...candidate, reasons });
      }
    }
  }

  return { vehicleConflict, customerMatches };
}
