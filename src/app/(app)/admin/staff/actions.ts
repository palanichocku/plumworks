"use server";

import { revalidatePath } from "next/cache";
import { ShopMembershipRole } from "@/generated/prisma/client";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { assertMemberRemovalAllowed, assertOwnerRoleAssignmentAllowed, assertRoleChangeAllowed } from "@/lib/staff-governance";

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
    const owners = await transaction.shopMembership.count({ where: { shopId: membership.shopId, role: "OWNER" } });
    assertRoleChangeAllowed({ actingRole: membership.role, targetRole: target.role, requestedRole: role, ownerCount: owners });
    await transaction.shopMembership.update({ where: { id: target.id }, data: { role } });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "member_role_changed", "shop_membership", target.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: "Staff membership", entityHref: "/admin/staff", contextSummary: "Staff member role changed" }), { category: "governance" });
  }, { isolationLevel: "Serializable" });
  revalidatePath("/admin/staff");
}

export async function removeMember(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!UUID.test(membershipId)) throw new Error("Invalid staff member.");
  const { user, membership } = await managerAccess();

  await prisma.$transaction(async (transaction) => {
    const target = await transaction.shopMembership.findFirst({ where: { id: membershipId, shopId: membership.shopId }, select: { id: true, role: true } });
    if (!target) return;
    const owners = await transaction.shopMembership.count({ where: { shopId: membership.shopId, role: "OWNER" } });
    assertMemberRemovalAllowed({ actingRole: membership.role, targetRole: target.role, ownerCount: owners });
    await transaction.shopMembership.delete({ where: { id: target.id } });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "member_removed", "shop_membership", target.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: "Staff membership", entityHref: "/admin/staff", contextSummary: "Staff member removed" }), { category: "governance" });
  }, { isolationLevel: "Serializable" });
  revalidatePath("/admin/staff");
}

export async function createStaffInvite(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as ShopMembershipRole;
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !roles.has(role)) throw new Error("Invalid staff invite.");
  const { user, membership } = await managerAccess();
  assertOwnerRoleAssignmentAllowed(membership.role, role);

  await prisma.$transaction(async (transaction) => {
    const invite = await transaction.staffInvite.upsert({
      where: { shopId_email: { shopId: membership.shopId, email } },
      update: { role, status: "pending", invitedByUserId: user?.id ?? null },
      create: { shopId: membership.shopId, email, role, invitedByUserId: user?.id ?? null },
      select: { id: true },
    });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "staff_invite_created", "staff_invite", invite.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: email, entityHref: "/admin/staff", contextSummary: "Staff invite created" }), { category: "governance" });
  });
  revalidatePath("/admin/staff");
}

export async function revokeStaffInvite(formData: FormData) {
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!UUID.test(inviteId)) throw new Error("Invalid staff invite.");
  const { user, membership } = await managerAccess();
  await prisma.$transaction(async (transaction) => {
    const invite = await transaction.staffInvite.findFirst({ where: { id: inviteId, shopId: membership.shopId, status: "pending" }, select: { email: true } });
    const result = await transaction.staffInvite.updateMany({
      where: { id: inviteId, shopId: membership.shopId, status: "pending" },
      data: { status: "revoked" },
    });
    if (result.count !== 1) throw new Error("Pending invitation was not found.");
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "staff_invite_revoked", "staff_invite", inviteId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: invite?.email ?? "Staff invite", entityHref: "/admin/staff", contextSummary: "Staff invite revoked" }), { category: "governance" });
  });
  revalidatePath("/admin/staff");
}
