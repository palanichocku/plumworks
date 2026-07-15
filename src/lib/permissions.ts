import "server-only";

import type { ShopMembershipRole } from "@/generated/prisma/client";
import matrix from "@/lib/permission-matrix.json";
import { getCurrentMembership } from "@/lib/data/membership";

export type Permission =
  | "view_dashboard"
  | "view_search"
  | "view_reports"
  | "edit_customer_vehicle"
  | "create_repair_order"
  | "edit_draft_repair_order"
  | "delete_draft_repair_order"
  | "finalize_repair_order"
  | "record_payment"
  | "edit_shop_settings"
  | "manage_canned_services"
  | "view_audit_log"
  | "manage_staff";

export function hasPermission(role: ShopMembershipRole, permission: Permission) {
  return (matrix[role] as Permission[]).includes(permission);
}

export async function requirePermission(permission: Permission) {
  const access = await getCurrentMembership();
  if (!access.membership || !hasPermission(access.membership.role, permission)) {
    throw new Error("You do not have permission to perform this action.");
  }
  return access as typeof access & {
    membership: NonNullable<typeof access.membership>;
  };
}
