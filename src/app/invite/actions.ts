"use server";

import { redirect } from "next/navigation";
import { auditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function acceptStaffInvite(formData: FormData) {
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!UUID.test(inviteId)) throw new Error("Invalid invitation.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) redirect("/login");

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT id FROM staff_invites
      WHERE id = ${inviteId}::uuid
      FOR UPDATE
    `;
    const invite = await transaction.staffInvite.findFirst({
      where: { id: inviteId, status: "pending", email: { equals: email, mode: "insensitive" } },
      select: { id: true, shopId: true, role: true },
    });
    if (!invite) throw new Error("This invitation is unavailable or does not match your account.");
    const existing = await transaction.shopMembership.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });
    if (existing) throw new Error("This invitation has already been accepted.");
    const membership = await transaction.shopMembership.create({
      data: { shopId: invite.shopId, userId: user.id, userEmail: email, role: invite.role },
      select: { id: true },
    });
    await transaction.staffInvite.update({ where: { id: invite.id }, data: { status: "accepted" } });
    await transaction.auditLog.create({ data: auditEntry(invite.shopId, user.id, "staff_invite_accepted", "staff_invite", invite.id, { membershipId: membership.id }, { actorEmail: email, actorRole: invite.role, entityLabel: email, entityHref: "/admin/staff", contextSummary: "Staff invite accepted" }) });
  }, { isolationLevel: "Serializable" });

  redirect("/dashboard");
}
