import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { changeMemberRole, createStaffInvite, removeMember } from "./actions";

export const dynamic = "force-dynamic";
const roleOptions = ["OWNER", "ADMIN", "STAFF"] as const;

export default async function StaffPage() {
  const { user, membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "manage_staff")) return <PermissionDenied />;

  const [members, invites] = await Promise.all([
    prisma.shopMembership.findMany({ where: { shopId: membership.shopId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, userId: true, role: true, createdAt: true } }),
    prisma.staffInvite.findMany({ where: { shopId: membership.shopId, status: "pending" }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, role: true, createdAt: true } }),
  ]);

  return <>
    <Link href="/settings" className="text-sm font-semibold text-sky-700 hover:text-sky-800">← Settings</Link>
    <div className="mt-5"><PageHeading eyebrow="Access" title="Staff" description="Manage shop membership roles and pending invitations." /></div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold">Current members</h2></div><div className="divide-y divide-slate-200">{members.map((member) => <form key={member.id} action={changeMemberRole} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_10rem_9rem_auto] sm:items-end"><input type="hidden" name="membershipId" value={member.id} /><div><p className="text-sm font-semibold text-slate-900">{member.userId === user?.id ? user?.email ?? "Email unavailable" : "Email unavailable"}</p><p className="mt-1 text-xs text-slate-500">Added {member.createdAt.toLocaleDateString("en-US")}</p></div><label className="text-sm font-semibold text-slate-700">Role<select name="role" defaultValue={member.role} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{roleOptions.map((role) => <option key={role}>{role}</option>)}</select></label><button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Update role</button><button type="submit" formAction={removeMember} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">Remove</button></form>)}</div></section>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Invite staff member</h2><p className="mt-2 text-sm text-slate-600">This records a pending invitation. Create the user in Supabase Auth, then link their user ID to the shop membership manually until automated email acceptance is added.</p><form action={createStaffInvite} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">Email<input name="email" type="email" required maxLength={254} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Role<select name="role" defaultValue="STAFF" className="mt-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{roleOptions.map((role) => <option key={role}>{role}</option>)}</select></label><button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Create invite</button></form></section>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Pending invites</h2>{invites.length === 0 ? <p className="mt-3 text-sm text-slate-600">No pending invites.</p> : <ul className="mt-4 divide-y divide-slate-200">{invites.map((invite) => <li key={invite.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span className="font-medium text-slate-900">{invite.email}</span><span className="text-slate-600">{invite.role} · {invite.createdAt.toLocaleDateString("en-US")}</span></li>)}</ul>}</section>
  </>;
}
