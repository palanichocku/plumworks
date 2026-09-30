"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { ShopMembershipRole } from "@/generated/prisma/client";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { assertMemberRemovalAllowed, assertOwnerRoleAssignmentAllowed, assertRoleChangeAllowed } from "@/lib/staff-governance";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendStaffAuthInvitation } from "@/lib/auth/staff-invitation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = new Set<ShopMembershipRole>(["OWNER", "ADMIN", "STAFF"]);

export type StaffInviteActionState = { status: "idle" | "success" | "error"; message?: string };

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
    if (target.role === "MONITOR") throw new Error("Monitoring accounts are managed outside staff roles.");
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
    if (target.role === "MONITOR") throw new Error("Monitoring accounts are managed outside staff roles.");
    const owners = await transaction.shopMembership.count({ where: { shopId: membership.shopId, role: "OWNER" } });
    assertMemberRemovalAllowed({ actingRole: membership.role, targetRole: target.role, ownerCount: owners });
    await transaction.shopMembership.delete({ where: { id: target.id } });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "member_removed", "shop_membership", target.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: "Staff membership", entityHref: "/admin/staff", contextSummary: "Staff member removed" }), { category: "governance" });
  }, { isolationLevel: "Serializable" });
  revalidatePath("/admin/staff");
}

export async function createStaffInvite(_previous: StaffInviteActionState, formData: FormData): Promise<StaffInviteActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as ShopMembershipRole;
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !roles.has(role)) throw new Error("Invalid staff invite.");
  const { user, membership } = await managerAccess();
  assertOwnerRoleAssignmentAllowed(membership.role, role);

  const inviteId = await prisma.$transaction(async (transaction) => {
    // Serialize creation even when no invitation row exists yet, then synchronize
    // with acceptance/revocation of an existing invitation before deciding to retry.
    await transaction.$queryRaw`SELECT id FROM shops WHERE id = ${membership.shopId}::uuid FOR UPDATE`;
    await transaction.$queryRaw`SELECT id FROM staff_invites WHERE shop_id = ${membership.shopId}::uuid AND email = ${email} FOR UPDATE`;
    const existing = await transaction.staffInvite.findUnique({
      where: { shopId_email: { shopId: membership.shopId, email } },
    });
    if (existing) assertOwnerRoleAssignmentAllowed(membership.role, existing.role);
    const member = await transaction.shopMembership.findFirst({
      where: { shopId: membership.shopId, userEmail: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (member) throw new Error("This account is already a shop member.");
    if (existing?.status === "pending") {
      if (existing.role !== role) throw new Error("Revoke the pending invitation before changing its role.");
      return existing.id;
    }
    const invite = await transaction.staffInvite.upsert({
      where: { shopId_email: { shopId: membership.shopId, email } },
      // Re-inviting former staff or a revoked invite gets a fresh acceptance ID.
      update: { id: randomUUID(), role, status: "pending", invitedByUserId: user?.id ?? null, createdAt: new Date() },
      create: { shopId: membership.shopId, email, role, invitedByUserId: user?.id ?? null },
      select: { id: true },
    });
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "staff_invite_created", "staff_invite", invite.id, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: email, entityHref: "/admin/staff", contextSummary: "Staff invite created" }), { category: "governance" });
    return invite.id;
  });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  let delivery: Awaited<ReturnType<typeof sendStaffAuthInvitation>> = { status: "failed" };
  if (siteUrl) {
    try {
      delivery = await sendStaffAuthInvitation(createAdminClient(), email, siteUrl);
    } catch {
      delivery = { status: "failed" };
    }
  }
  if (delivery.status === "failed") {
    await prisma.$transaction(async (transaction) => {
      await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "staff_invite_delivery_failed", "staff_invite", inviteId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: email, entityHref: "/admin/staff", contextSummary: "Supabase Auth invitation delivery was not confirmed" }), { category: "governance" });
    });
    revalidatePath("/admin/staff");
    return { status: "error", message: "The invitation email could not be confirmed as sent. The pending invitation is saved; check Supabase Auth and email delivery settings before retrying." };
  }

  revalidatePath("/admin/staff");
  if (delivery.status === "existing_account") {
    return { status: "success", message: "Invitation saved. This email already has an Auth account; no invitation email was sent. Ask the recipient to sign in to PlumWorks to accept, or use Forgot password if needed." };
  }
  return { status: "success", message: `Supabase accepted the invitation email request for ${email}.` };
}

export async function revokeStaffInvite(formData: FormData) {
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!UUID.test(inviteId)) throw new Error("Invalid staff invite.");
  const { user, membership } = await managerAccess();
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM staff_invites WHERE id = ${inviteId}::uuid AND shop_id = ${membership.shopId}::uuid FOR UPDATE`;
    const invite = await transaction.staffInvite.findFirst({ where: { id: inviteId, shopId: membership.shopId, status: "pending" }, select: { email: true, role: true } });
    if (!invite) throw new Error("Pending invitation was not found.");
    assertOwnerRoleAssignmentAllowed(membership.role, invite.role);
    const result = await transaction.staffInvite.updateMany({
      where: { id: inviteId, shopId: membership.shopId, status: "pending" },
      data: { status: "revoked" },
    });
    if (result.count !== 1) throw new Error("Pending invitation was not found.");
    await writeAuditEntry(transaction, auditEntry(membership.shopId, user?.id, "staff_invite_revoked", "staff_invite", inviteId, { source: "web" }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: invite?.email ?? "Staff invite", entityHref: "/admin/staff", contextSummary: "Staff invite revoked" }), { category: "governance" });
  });
  revalidatePath("/admin/staff");
}
