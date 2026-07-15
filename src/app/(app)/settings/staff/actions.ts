"use server";

import { revalidatePath } from "next/cache";
import { ShopMembershipRole } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = new Set(Object.values(ShopMembershipRole));

async function managerAccess() {
  return requirePermission("manage_staff");
}

export async function changeMemberRole(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "");
  const role = String(formData.get("role") ?? "") as ShopMembershipRole;
  if (!UUID.test(membershipId) || !roles.has(role)) throw new Error("Invalid staff update.");
  const { user, membership } = await managerAccess();

  await prisma.$transaction(async (transaction) => {
    const target = await transaction.shopMembership.findFirst({ where: { id: membershipId, shopId: membership.shopId }, select: { id: true, role: true } });
    if (!target) throw new Error("Staff member was not found.");
    if (target.role === "OWNER" && role !== "OWNER") {
      const owners = await transaction.shopMembership.count({ where: { shopId: membership.shopId, role: "OWNER" } });
      if (owners <= 1) throw new Error("The last owner cannot be demoted.");
    }
    await transaction.shopMembership.update({ where: { id: target.id }, data: { role } });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "member_role_changed", "shop_membership", target.id, { source: "web" }) });
  }, { isolationLevel: "Serializable" });
  revalidatePath("/settings/staff");
}

export async function removeMember(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!UUID.test(membershipId)) throw new Error("Invalid staff member.");
  const { user, membership } = await managerAccess();

  await prisma.$transaction(async (transaction) => {
    const target = await transaction.shopMembership.findFirst({ where: { id: membershipId, shopId: membership.shopId }, select: { id: true, role: true } });
    if (!target) return;
    if (target.role === "OWNER") {
      const owners = await transaction.shopMembership.count({ where: { shopId: membership.shopId, role: "OWNER" } });
      if (owners <= 1) throw new Error("The last owner cannot be removed.");
    }
    await transaction.shopMembership.delete({ where: { id: target.id } });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "member_removed", "shop_membership", target.id, { source: "web" }) });
  }, { isolationLevel: "Serializable" });
  revalidatePath("/settings/staff");
}

export async function createStaffInvite(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as ShopMembershipRole;
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !roles.has(role)) throw new Error("Invalid staff invite.");
  const { user, membership } = await managerAccess();

  await prisma.$transaction(async (transaction) => {
    const invite = await transaction.staffInvite.upsert({
      where: { shopId_email: { shopId: membership.shopId, email } },
      update: { role, status: "pending", invitedByUserId: user?.id ?? null },
      create: { shopId: membership.shopId, email, role, invitedByUserId: user?.id ?? null },
      select: { id: true },
    });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "staff_invite_created", "staff_invite", invite.id, { source: "web" }) });
  });
  revalidatePath("/settings/staff");
}
