import Link from "next/link";
import { MarketingLeadStatus } from "@/generated/prisma/client";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { updateLeadStatus } from "./actions";
import { callClickMessage } from "@/lib/marketing-lead-context";

const statusLabels = { NEW: "New", CONTACTED: "Contacted", SCHEDULED: "Scheduled", CONVERTED: "Converted", CLOSED: "Closed" } as const;
const sourceLabels = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" } as const;

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ membership }, query] = await Promise.all([requirePermission("edit_shop_settings"), searchParams]);
  const selected = Object.values(MarketingLeadStatus).includes(query.status as MarketingLeadStatus)
    ? query.status as MarketingLeadStatus
    : undefined;
  const [leads, newLeadCount] = await Promise.all([
    prisma.marketingLead.findMany({
      where: { shopId: membership.shopId, ...(selected ? { status: selected } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.marketingLead.count({ where: { shopId: membership.shopId, status: "NEW" } }),
  ]);

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <PageHeading eyebrow="Admin" title="Marketing Leads" description="Review public contact, appointment, and drop-off requests. Leads remain separate from customer and vehicle records." />
      <Link href="/admin/leads?status=NEW" className="shrink-0 rounded-xl bg-orange-50 px-4 py-3 text-sm font-black text-orange-700">{newLeadCount} new {newLeadCount === 1 ? "lead" : "leads"}</Link>
    </div>
    <nav className="flex flex-wrap gap-2">
      <Link href="/admin/leads" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">All</Link>
      {Object.values(MarketingLeadStatus).map((status) => <Link key={status} href={`/admin/leads?status=${status}`} className={`rounded-lg border px-3 py-2 text-sm font-bold ${selected === status ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 bg-white"}`}>{statusLabels[status]}</Link>)}
    </nav>
    <div className="space-y-4">
      {leads.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">No matching leads.</div>}
      {leads.map((lead) => <article key={lead.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black">{lead.name}</h2><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-black text-orange-700">{lead.source === "CONTACT" && lead.message === callClickMessage ? "Call click" : sourceLabels[lead.source]}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{statusLabels[lead.status]}</span></div>
            {lead.phone && <p className="mt-3 text-lg font-black text-slate-950">{lead.phone}</p>}
            {lead.email && <p className="mt-1 text-sm font-semibold text-slate-600">{lead.email}</p>}
            {(lead.vehicleYear || lead.vehicleMake || lead.vehicleModel) && <p className="mt-4 text-base font-black text-slate-800">{[lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ")}</p>}
            {(lead.preferredDate || lead.preferredTime) && <p className="mt-1 text-sm text-slate-600">Preferred: {lead.preferredDate?.toLocaleDateString() ?? "Date not provided"}{lead.preferredTime ? ` at ${lead.preferredTime}` : ""}</p>}
            {(lead.scheduledDate || lead.scheduledTime) && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800">Scheduled: {lead.scheduledDate?.toLocaleDateString() ?? "Date not provided"}{lead.scheduledTime ? ` at ${lead.scheduledTime}` : ""}</p>}
            {lead.requestedService && <div className="mt-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Requested service</p><p className="mt-1 font-bold">{lead.requestedService}</p></div>}
            {lead.message && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-600">{lead.message}</p>}
            <div className="mt-5 flex flex-wrap gap-2">{lead.phone && <a href={`tel:${lead.phone.replaceAll(/[^\d+]/g, "")}`} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white">Call customer</a>}{lead.email && <a href={`mailto:${lead.email}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700">Email customer</a>}</div>
            <p className="mt-4 text-xs text-slate-400">Submitted {lead.createdAt.toLocaleString()}</p>
          </div>
          <form action={updateLeadStatus} className="grid w-full shrink-0 gap-3 rounded-xl bg-slate-50 p-4 lg:w-80"><input type="hidden" name="id" value={lead.id} /><label className="text-xs font-black uppercase tracking-wider text-slate-500">Status<select aria-label={`Status for ${lead.name}`} name="status" defaultValue={lead.status} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-900">{Object.values(MarketingLeadStatus).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><label className="text-xs font-black uppercase tracking-wider text-slate-500">Scheduled date<input name="scheduledDate" type="date" defaultValue={lead.scheduledDate?.toISOString().slice(0, 10) ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900" /></label><label className="text-xs font-black uppercase tracking-wider text-slate-500">Time<input name="scheduledTime" type="time" defaultValue={lead.scheduledTime ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900" /></label></div><label className="text-xs font-black uppercase tracking-wider text-slate-500">Internal note<textarea name="internalNote" rows={3} maxLength={3000} defaultValue={lead.internalNote ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900" /></label><button className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white">Save lead</button></form>
        </div>
      </article>)}
    </div>
  </div>;
}
