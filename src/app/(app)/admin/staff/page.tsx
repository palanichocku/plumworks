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
      const result = await transaction.shopMembership.updateMany({ 
        where: { 
          id: membership.id, 
          shopId: membership.shopId, 
          OR: [{ userEmail: null }, { userEmail: { not: currentEmail } }] 
        }, 
        data: { userEmail: currentEmail } 
      });
      if (result.count === 1) {
        await transaction.auditLog.create({ 
          data: auditEntry(
            membership.shopId, 
            user?.id, 
            "membership_email_backfilled", 
            "shop_membership", 
            membership.id, 
            { source: "authenticated_session" }, 
            { actorEmail: currentEmail, actorRole: membership.role, entityLabel: "Staff membership", entityHref: "/admin/staff", contextSummary: "Membership email snapshot updated" }
          ) 
        });
      }
    });
  }

  const [members, invites] = await Promise.all([
    prisma.shopMembership.findMany({ 
      where: { shopId: membership.shopId }, 
      orderBy: [{ role: "asc" }, { createdAt: "asc" }], 
      select: { id: true, userId: true, userEmail: true, role: true, createdAt: true } 
    }),
    prisma.staffInvite.findMany({ 
      where: { shopId: membership.shopId, status: "pending" }, 
      orderBy: { createdAt: "desc" }, 
      select: { id: true, email: true, role: true, createdAt: true } 
    }),
  ]);

  const labelClass = "block text-xs font-bold uppercase tracking-wider text-slate-500 w-full";
  const selectClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-medium outline-none transition-all focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 shadow-2xs cursor-pointer";
  const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-medium outline-none transition-all focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 shadow-2xs";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Structural Back Link Navigation Button */}
      <div>
        <Link 
          href="/admin" 
          className="group inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-sky-600 transition-colors focus:outline-none"
        >
          <span className="font-mono text-sm transition-transform group-hover:-translate-x-0.5">←</span>
          Back to Admin Panel
        </Link>
      </div>

      {/* Main Page Header */}
      <PageHeading 
        eyebrow="Admin" 
        title="Staff" 
        description="Manage global workspace user permissions, active shop membership roles, and pending ecosystem invitations." 
      />

      {/* Current Members Grid Card */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50/50 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Current Members</h2>
        </div>
        
        <div className="divide-y divide-slate-200">
          {members.map((member) => (
            <form 
              key={member.id} 
              action={changeMemberRole} 
              className="grid gap-4 px-5 py-4 sm:grid-cols-[2fr_12rem_auto_auto] sm:items-end transition-colors hover:bg-slate-50/30"
            >
              <input type="hidden" name="membershipId" value={member.id} />
              
              <div className="pr-2">
                <p className="text-sm font-bold text-slate-900">
                  {member.userEmail ?? (member.userId === user?.id ? currentEmail : null) ?? "Email unavailable"}
                </p>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  Registered account · Added {member.createdAt.toLocaleDateString("en-US")}
                </p>
              </div>
              
              <label className={labelClass}>
                Workspace Role
                <select name="role" defaultValue={member.role} className={selectClass}>
                  {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              
              <FormSubmitButton 
                pendingLabel="Updating…" 
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 focus:outline-none"
              >
                Update Role
              </FormSubmitButton>
              
              <FormSubmitButton 
                formAction={removeMember} 
                pendingLabel="Removing…" 
                confirmTitle="Remove this staff member?" 
                confirmDescription="This person will lose all real-time access to the shop instantly. This vector cannot be undone." 
                confirmLabel="Remove staff member" 
                destructive 
                className="rounded-lg border border-red-200 bg-red-50/30 px-4 py-2 text-sm font-semibold text-red-600 shadow-2xs transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                Remove
              </FormSubmitButton>
            </form>
          ))}
        </div>
      </section>

      {/* Invite Staff Member Panel Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900">Invite new team member</h2>
          <div className="mt-1.5 space-y-1 text-sm font-medium text-slate-500">
            <p>Invites configure a pending Car Doc association snapshot placeholder vector.</p>
            <p className="text-xs text-slate-400 font-normal">
              Note: Automated transaction mail loops are deferred. An administrator must explicitly configure matching credentials inside Supabase Auth.
            </p>
          </div>
        </div>
        
        <form action={createStaffInvite} className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wider text-slate-500">
            Email address
            <input 
              name="email" 
              type="email" 
              required 
              maxLength={254} 
              placeholder="mechanic@cardoc.com" 
              className={inputClass} 
            />
          </label>
          
          <label className="w-full sm:w-48 text-xs font-bold uppercase tracking-wider text-slate-500">
            Initial Role
            <select name="role" defaultValue="STAFF" className={selectClass}>
              {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          
          <button 
            type="submit" 
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-sky-700 focus:outline-none focus:ring-4 focus:ring-sky-500/20 whitespace-nowrap"
          >
            Create Invite
          </button>
        </form>
      </section>

      {/* Pending Invites List Panel Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Pending invitations</h2>
        
        {invites.length === 0 ? (
          <p className="mt-3 text-sm font-medium text-slate-500">
            No active pending workspace invitations currently outstanding.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-slate-50/10">
            {invites.map((invite) => (
              <li 
                key={invite.id} 
                className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-sm transition-colors hover:bg-slate-50/30"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-slate-900">{invite.email}</span>
                  <span className="text-xs font-medium text-slate-500">
                    Role Assigned: <strong className="text-slate-700 font-semibold">{invite.role}</strong> · Created {invite.createdAt.toLocaleDateString("en-US")}
                  </span>
                </div>
                
                <form action={revokeStaffInvite}>
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <FormSubmitButton 
                    pendingLabel="Revoking…" 
                    confirmTitle="Revoke this pending invitation?" 
                    confirmDescription="The token mapping signature will be invalidated immediately. This cannot be reversed." 
                    confirmLabel="Revoke invite" 
                    destructive 
                    className="rounded-lg border border-red-200 bg-red-50/20 px-3 py-1.5 text-xs font-bold text-red-600 shadow-2xs transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  >
                    Revoke
                  </FormSubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
