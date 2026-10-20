import Link from "next/link";
import { MarketingLeadStatus } from "@/generated/prisma/client";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { requirePermission, hasPermission } from "@/lib/permissions";
import { MarketingLeadCard } from "@/components/marketing-lead-card";
import { leadReadNotification } from "@/lib/marketing-lead-read-presentation";
import { operationalMarketingLeadWhere } from "@/lib/marketing-lead-query";

const lifecycleTabs = ["NEW", "CONTACTED", "SCHEDULED", "CONVERTED", "COMPLETED", "CLOSED", "ALL"] as const;
type LifecycleTab = typeof lifecycleTabs[number];
const statusLabels: Record<LifecycleTab, string> = { NEW: "New", CONTACTED: "Contacted", SCHEDULED: "Scheduled", CONVERTED: "Converted", COMPLETED: "Completed", CLOSED: "Lost", ALL: "All" };

export const dynamic = "force-dynamic";

function derivedLifecycleStatus(lead: { status: MarketingLeadStatus; convertedAt: Date | null; customer: { invoices: Array<{ status: string; createdAt: Date }> } | null }) {
  if (lead.status !== MarketingLeadStatus.CONVERTED) return lead.status;
  const latestInvoice = lead.customer?.invoices[0];
  if (!latestInvoice) return "CONVERTED" as const;
  const belongsToConvertedWork = !lead.convertedAt || latestInvoice.createdAt >= lead.convertedAt;
  return belongsToConvertedWork && latestInvoice.status === "closed" ? "COMPLETED" as const : "CONVERTED" as const;
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; lead?: string }> }) {
  const [{ user, membership }, query] = await Promise.all([requirePermission("view_marketing_leads"), searchParams]);
  if (!user) throw new Error("Sign in to view leads.");
  const requested = lifecycleTabs.includes((query.status ?? "") as LifecycleTab) ? (query.status as LifecycleTab) : "NEW";
  const selected = requested === "ALL" ? undefined : requested;
  const leadId = query.lead && /^[0-9a-f-]{36}$/i.test(query.lead) ? query.lead : undefined;
  const dbStatus = selected === "COMPLETED" ? MarketingLeadStatus.CONVERTED : selected === undefined ? undefined : selected as MarketingLeadStatus;

  const [candidateLeads, newLeadCount] = await Promise.all([
    prisma.marketingLead.findMany({
      where: { ...operationalMarketingLeadWhere(membership.shopId, leadId ? undefined : dbStatus), ...(leadId ? { id: leadId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        notification: { include: { reads: { where: { shopId: membership.shopId, userId: user.id }, select: { readAt: true } } } },
        customer: { select: { invoices: { where: { legacySourceTable: null, repairOrderNumber: { not: null } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } } } },
      },
    }),
    prisma.marketingLead.count({ where: operationalMarketingLeadWhere(membership.shopId, "NEW") }),
  ]);

  const leads = candidateLeads.filter((lead) => {
    if (leadId || selected === undefined) return true;
    const lifecycle = derivedLifecycleStatus(lead);
    return lifecycle === selected;
  });

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <PageHeading eyebrow="Operations" title="Leads" description="Track website leads from first contact through completed, paid work. Leads that never become business end at Lost." />
      <Link href="/leads?status=NEW" className="shrink-0 rounded-xl bg-orange-50 px-4 py-3 text-sm font-black text-orange-700">{newLeadCount} new {newLeadCount === 1 ? "lead" : "leads"}</Link>
    </div>
    <nav aria-label="Lead status" className="flex flex-wrap gap-2">
      {lifecycleTabs.map((status) => <Link key={status} href={`/leads?status=${status}`} aria-current={(selected ?? "ALL") === status ? "page" : undefined} className={`rounded-lg border px-3 py-2 text-sm font-bold ${(selected ?? "ALL") === status ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 bg-white"}`}>{statusLabels[status]}</Link>)}
    </nav>
    <div className="space-y-4">
      {leads.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">No matching leads.</div>}
      {leads.map((lead) => <MarketingLeadCard key={lead.id} lead={lead} lifecycleStatus={derivedLifecycleStatus(lead)} notification={leadReadNotification(lead)} canManage={hasPermission(membership.role, "manage_marketing_leads")} />)}
    </div>
  </div>;
}
