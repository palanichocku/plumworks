import type { Prisma } from "@/generated/prisma/client";

export type LifecycleFilter = "active" | "archived" | "all";

export function parseLifecycleFilter(value?: string): LifecycleFilter {
  return value === "archived" || value === "all" ? value : "active";
}

export const activeCustomerAvailability: Prisma.CustomerWhereInput = { archivedAt: null };

export const activeVehicleAvailability: Prisma.VehicleWhereInput = {
  archivedAt: null,
  customer: { archivedAt: null },
};

export function customerLifecycleWhere(filter: LifecycleFilter): Prisma.CustomerWhereInput {
  if (filter === "active") return activeCustomerAvailability;
  if (filter === "archived") return { archivedAt: { not: null } };
  return {};
}

export function vehicleLifecycleWhere(filter: LifecycleFilter): Prisma.VehicleWhereInput {
  if (filter === "active") return activeVehicleAvailability;
  if (filter === "archived") {
    return { OR: [{ archivedAt: { not: null } }, { customer: { archivedAt: { not: null } } }] };
  }
  return {};
}
