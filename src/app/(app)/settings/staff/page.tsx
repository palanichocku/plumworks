import Link from "next/link";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { auditEntry } from "@/lib/audit";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { changeMemberRole, createStaffInvite, removeMember, revokeStaffInvite } from "./actions";

export const dynamic = "force-dynamic";
const roleOptions = ["OWNER", "ADMIN", "STAFF"] as const;

export default async function StaffPage() {
  const { user, membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "manage_staff")) return <PermissionDenied />;

  const currentEmail = user?.email?.trim().toLowerCase() ?? null;
  if (currentEmail) {
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.shopMembership.updateMany({ where: { id: membership.id, shopId: membership.shopId, OR: [{ userEmail: null }, { userEmail: { not: currentEmail } }] }, data: { userEmail: currentEmail } });
      if (result.count === 1) await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "membership_email_backfilled", "shop_membership", membership.id, { source: "authenticated_session" }, { actorEmail: currentEmail, actorRole: membership.role, entityLabel: "Staff membership", entityHref: "/admin/staff", contextSummary: "Membership email snapshot updated" }) });
    });
  }

  const [members, invites] = await Promise.all([
    prisma.shopMembership.findMany({ where: { shopId: membership.shopId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, userId: true, userEmail: true, role: true, createdAt: true } }),
    prisma.staffInvite.findMany({ where: { shopId: membership.shopId, status: "pending" }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, role: true, createdAt: true } }),
  ]);

  return <>
    <Link href="/admin" className="text-sm font-semibold text-sky-700 hover:text-sky-800">← Admin</Link>
    <div className="mt-5"><PageHeading eyebrow="Access" title="Staff" description="Manage shop membership roles and pending invitations." /></div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold">Current members</h2></div>
      <div className="divide-y divide-slate-200">{members.map((member) => <form key={member.id} action={changeMemberRole} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_10rem_9rem_auto] sm:items-end">
        <input type="hidden" name="membershipId" value={member.id} />
        <div><p className="text-sm font-semibold text-slate-900">{member.userEmail ?? (member.userId === user?.id ? currentEmail : null) ?? "Email unavailable"}</p><p className="mt-1 text-xs text-slate-500">Added {member.createdAt.toLocaleDateString("en-US")}</p></div>
        <label className="text-sm font-semibold text-slate-700">Role<select name="role" defaultValue={member.role} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{roleOptions.map((role) => <option key={role}>{role}</option>)}</select></label>
        <FormSubmitButton pendingLabel="Updating…" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Update role</FormSubmitButton>
        <FormSubmitButton formAction={removeMember} pendingLabel="Removing…" confirmTitle="Remove this staff member?" confirmDescription="This person will lose access to the shop. This cannot be undone from the audit log." confirmLabel="Remove staff member" destructive className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Remove</FormSubmitButton>
      </form>)}</div>
    </section>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Invite staff member</h2><div className="mt-2 space-y-2 text-sm leading-6 text-slate-600"><p>Invites create a pending Car Doc invitation. If the invited person does not already have a login, an owner must create the user manually in Supabase Auth using the same email address.</p><p>The user can then log in with that email and accept the invitation. Automated invite emails and self-service signup are intentionally deferred.</p></div><form action={createStaffInvite} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">Email<input name="email" type="email" required maxLength={254} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Role<select name="role" defaultValue="STAFF" className="mt-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{roleOptions.map((role) => <option key={role}>{role}</option>)}</select></label><button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Create invite</button></form></section>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Pending invites</h2>{invites.length === 0 ? <p className="mt-3 text-sm text-slate-600">No pending invites.</p> : <ul className="mt-4 divide-y divide-slate-200">{invites.map((invite) => <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span className="font-medium text-slate-900">{invite.email}</span><span className="text-slate-600">{invite.role} · {invite.createdAt.toLocaleDateString("en-US")}</span><form action={revokeStaffInvite}><input type="hidden" name="inviteId" value={invite.id} /><FormSubmitButton pendingLabel="Revoking…" confirmTitle="Revoke this pending invitation?" confirmDescription="The invitation will no longer be available for acceptance." confirmLabel="Revoke invite" destructive className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Revoke</FormSubmitButton></form></li>)}</ul>}</section>
  </>;
}
