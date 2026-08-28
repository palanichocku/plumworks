import type { ShopMembershipRole } from "@/generated/prisma/client";

type RoleChange = {
  actingRole: ShopMembershipRole;
  targetRole: ShopMembershipRole;
  requestedRole: ShopMembershipRole;
  ownerCount: number;
};

export function assertOwnerRoleAssignmentAllowed(actingRole: ShopMembershipRole, requestedRole: ShopMembershipRole) {
  if (actingRole !== "OWNER" && requestedRole === "OWNER") {
    throw new Error("Only an owner can grant owner access.");
  }
}

export function assertRoleChangeAllowed({ actingRole, targetRole, requestedRole, ownerCount }: RoleChange) {
  assertOwnerRoleAssignmentAllowed(actingRole, requestedRole);
  if (actingRole !== "OWNER" && targetRole === "OWNER") {
    throw new Error("Only an owner can manage owner access.");
  }
  if (targetRole === "OWNER" && requestedRole !== "OWNER" && ownerCount <= 1) {
    throw new Error("The last owner cannot be demoted.");
  }
}

export function assertMemberRemovalAllowed(input: {
  actingRole: ShopMembershipRole;
  targetRole: ShopMembershipRole;
  ownerCount: number;
}) {
  if (input.targetRole === "OWNER" && input.actingRole !== "OWNER") {
    throw new Error("Only an owner can remove an owner.");
  }
  if (input.targetRole === "OWNER" && input.ownerCount <= 1) {
    throw new Error("The last owner cannot be removed.");
  }
}
