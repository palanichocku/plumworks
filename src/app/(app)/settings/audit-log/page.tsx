import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "view_audit_log")) return <PermissionDenied />;
  const events = await prisma.auditLog.findMany({
    where: { shopId: membership.shopId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: { id: true, action: true, entityType: true, createdAt: true, userId: true },
  });

  return <>
    <Link href="/settings" className="text-sm font-semibold text-sky-700 hover:text-sky-800">← Settings</Link>
    <div className="mt-5"><PageHeading eyebrow="Security" title="Audit Log" description="Recent important actions for this shop. Sensitive field values are not recorded." /></div>
    {events.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="text-lg font-semibold">No audit events yet</h2><p className="mt-2 text-sm text-slate-600">New shop changes will appear here.</p></section> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Action</th><th className="px-5 py-3">Entity</th><th className="px-5 py-3">Actor</th></tr></thead><tbody className="divide-y divide-slate-200">{events.map((event) => <tr key={event.id}><td className="px-5 py-4 text-slate-600">{event.createdAt.toLocaleString("en-US")}</td><td className="px-5 py-4 font-medium text-slate-950">{event.action.replaceAll("_", " ")}</td><td className="px-5 py-4 capitalize text-slate-600">{event.entityType.replaceAll("_", " ")}</td><td className="px-5 py-4 text-slate-600">{event.userId ? "Shop user" : "System"}</td></tr>)}</tbody></table><p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">Showing the 100 most recent events.</p></section>}
  </>;
}
