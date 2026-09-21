import Link from "next/link";
import { MarketingLeadStatus } from "@/generated/prisma/client";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { requirePermission, hasPermission } from "@/lib/permissions";
import { MarketingLeadCard } from "@/components/marketing-lead-card";
import { leadReadNotification } from "@/lib/marketing-lead-read-presentation";

const statusLabels = { NEW: "New", CONTACTED: "Contacted", SCHEDULED: "Scheduled", CONVERTED: "Converted", CLOSED: "Closed" } as const;

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; lead?: string }> }) {
  const [{ user, membership }, query] = await Promise.all([requirePermission("view_marketing_leads"), searchParams]);
  if (!user) throw new Error("Sign in to view leads.");
  const selected = query.status === "ALL" ? undefined : Object.values(MarketingLeadStatus).includes(query.status as MarketingLeadStatus)
    ? query.status as MarketingLeadStatus
    : MarketingLeadStatus.NEW;
  const [leads, newLeadCount] = await Promise.all([
    prisma.marketingLead.findMany({
      where: { shopId: membership.shopId, ...(query.lead && /^[0-9a-f-]{36}$/i.test(query.lead) ? { id: query.lead } : selected ? { status: selected } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: { notification: { include: { reads: { where: { shopId: membership.shopId, userId: user.id }, select: { readAt: true } } } } },
    }),
    prisma.marketingLead.count({ where: { shopId: membership.shopId, status: "NEW" } }),
  ]);

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <PageHeading eyebrow="Operations" title="Leads" description="Review public contact, appointment, and drop-off requests. Leads remain separate from customer and vehicle records." />
      <Link href="/leads?status=NEW" className="shrink-0 rounded-xl bg-orange-50 px-4 py-3 text-sm font-black text-orange-700">{newLeadCount} new {newLeadCount === 1 ? "lead" : "leads"}</Link>
    </div>
    <nav aria-label="Lead status" className="flex flex-wrap gap-2">
      {Object.values(MarketingLeadStatus).map((status) => <Link key={status} href={`/leads?status=${status}`} aria-current={selected === status ? "page" : undefined} className={`rounded-lg border px-3 py-2 text-sm font-bold ${selected === status ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 bg-white"}`}>{statusLabels[status]}</Link>)}
      <Link href="/leads?status=ALL" aria-current={selected === undefined ? "page" : undefined} className={`rounded-lg border px-3 py-2 text-sm font-bold ${selected === undefined ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 bg-white"}`}>All</Link>
    </nav>
    <div className="space-y-4">
      {leads.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">No matching leads.</div>}
      {leads.map((lead) => <MarketingLeadCard key={lead.id} lead={lead} notification={leadReadNotification(lead)} canManage={hasPermission(membership.role, "manage_marketing_leads")} />)}
    </div>
  </div>;
}
