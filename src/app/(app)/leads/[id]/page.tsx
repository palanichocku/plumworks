import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingLeadStatus } from "@/generated/prisma/client";
import { getOperationalLead } from "@/lib/marketing-lead-notification-center";
import { hasPermission } from "@/lib/permissions";
import { PageHeading } from "@/components/page-heading";
import { MarketingLeadCard } from "@/components/marketing-lead-card";
import { leadReadNotification } from "@/lib/marketing-lead-read-presentation";

export const dynamic = "force-dynamic";

function derivedLifecycleStatus(lead: { status: MarketingLeadStatus; convertedAt: Date | null; customer: { invoices: Array<{ status: string; createdAt: Date }> } | null }) {
  if (lead.status !== MarketingLeadStatus.CONVERTED) return lead.status;
  const latestInvoice = lead.customer?.invoices[0];
  if (!latestInvoice) return "CONVERTED" as const;
  const belongsToConvertedWork = !lead.convertedAt || latestInvoice.createdAt >= lead.convertedAt;
  return belongsToConvertedWork && latestInvoice.status === "closed" ? "COMPLETED" as const : "CONVERTED" as const;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { lead, role } = await getOperationalLead((await params).id);
  if (!lead) notFound();
  return <div className="space-y-6">
    <Link href="/leads" className="text-sm font-semibold text-brand-primary">← All Leads</Link>
    <PageHeading eyebrow="Operations" title="Lead details" description="Review this website lead and its progress from request through paid work." />
    <MarketingLeadCard lead={lead} lifecycleStatus={derivedLifecycleStatus(lead)} notification={leadReadNotification(lead)} canManage={hasPermission(role, "manage_marketing_leads")} />
  </div>;
}
