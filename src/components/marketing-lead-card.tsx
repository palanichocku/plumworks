import Link from "next/link";
import { MarketingLeadStatus, type MarketingLead } from "@/generated/prisma/client";
import { updateLeadStatus } from "@/app/(app)/leads/manage-actions";
import { callClickMessage } from "@/lib/marketing-lead-context";
import { LeadReadControl, type LeadReadNotification } from "@/components/lead-read-control";

const statusLabels = { NEW: "New", CONTACTED: "Contacted", SCHEDULED: "Scheduled", CONVERTED: "Converted", CLOSED: "Closed" } as const;
const sourceLabels = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" } as const;

export function MarketingLeadCard({ lead, notification, canManage }: { lead: MarketingLead; notification: LeadReadNotification | null; canManage: boolean }) {
  return <article id={`lead-${lead.id}`} className="scroll-mt-24 target:ring-2 target:ring-orange-400 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <LeadReadControl notification={notification} />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black"><Link href={`/leads/${lead.id}`}>{lead.name}</Link></h2><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-black text-orange-700">{lead.source === "CONTACT" && lead.message === callClickMessage ? "Call click" : sourceLabels[lead.source]}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${lead.status === "NEW" ? "bg-orange-100 text-orange-800" : "bg-slate-100"}`}>{statusLabels[lead.status]}</span></div>
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
          {canManage && <form action={updateLeadStatus} className="grid w-full shrink-0 gap-3 rounded-xl bg-slate-50 p-4 lg:w-80"><input type="hidden" name="id" value={lead.id} /><label className="text-xs font-black uppercase tracking-wider text-slate-500">Status<select aria-label={`Status for ${lead.name}`} name="status" defaultValue={lead.status} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-900">{Object.values(MarketingLeadStatus).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><label className="text-xs font-black uppercase tracking-wider text-slate-500">Scheduled date<input name="scheduledDate" type="date" defaultValue={lead.scheduledDate?.toISOString().slice(0, 10) ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900" /></label><label className="text-xs font-black uppercase tracking-wider text-slate-500">Time<input name="scheduledTime" type="time" defaultValue={lead.scheduledTime ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900" /></label></div><label className="text-xs font-black uppercase tracking-wider text-slate-500">Internal note<textarea name="internalNote" rows={3} maxLength={3000} defaultValue={lead.internalNote ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900" /></label><button className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white">Save lead</button></form>}
        </div>
      </article>;
}
