import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperationalLead } from "@/lib/marketing-lead-notification-center";
import { hasPermission } from "@/lib/permissions";
import { PageHeading } from "@/components/page-heading";
import { MarketingLeadCard } from "@/components/marketing-lead-card";
import { leadReadNotification } from "@/lib/marketing-lead-read-presentation";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { lead, role } = await getOperationalLead((await params).id);
  if (!lead) notFound();
  return <div className="space-y-6">
    <Link href="/leads" className="text-sm font-semibold text-brand-primary">← All Leads</Link>
    <PageHeading eyebrow="Operations" title="Lead details" description="Review and manage this website request. Notification reads and lead status are separate." />
    <MarketingLeadCard lead={lead} notification={leadReadNotification(lead)} canManage={hasPermission(role, "manage_marketing_leads")} />
  </div>;
}
