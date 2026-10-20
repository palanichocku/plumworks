import Link from "next/link";
import { MarketingLeadStatus, type MarketingLead } from "@/generated/prisma/client";
import { LeadManagementForm } from "@/components/lead-management-form";
import { callClickMessage } from "@/lib/marketing-lead-context";
import { LeadReadControl, type LeadReadNotification } from "@/components/lead-read-control";
import { leadContactMethodLabels } from "@/lib/marketing-lead-contact";

const statusLabels = { NEW: "New", CONTACTED: "Contacted", SCHEDULED: "Scheduled", CONVERTED: "Converted", COMPLETED: "Completed", CLOSED: "Lost" } as const;
const sourceLabels = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" } as const;
const manualStatuses = [MarketingLeadStatus.NEW, MarketingLeadStatus.CONTACTED, MarketingLeadStatus.SCHEDULED, MarketingLeadStatus.CLOSED] as const;
type LifecycleStatus = keyof typeof statusLabels;
const wonStages: LifecycleStatus[] = ["NEW", "CONTACTED", "SCHEDULED", "CONVERTED", "COMPLETED"];

function requestedTimeLabel(time: string | null) {
  if (!time) return "No time preference";
  const [hour, minute] = time.split(":");
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) >= 12 ? "PM" : "AM"}`;
}

function LifecycleRail({ status }: { status: LifecycleStatus }) {
  if (status === "CLOSED") return <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-800">Lost · this lead did not become business</div>;
  const current = wonStages.indexOf(status);
  return <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
    {wonStages.map((stage, index) => <div key={stage} className="flex items-center gap-2">
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${index <= current ? (stage === "COMPLETED" ? "border-emerald-700 bg-emerald-700 text-white" : "border-brand-primary bg-brand-primary text-white") : "border-slate-300 bg-white"}`}>{index < current ? "✓" : index + 1}</span>
      <span className={index === current ? (stage === "COMPLETED" ? "text-emerald-700" : "text-brand-primary") : ""}>{statusLabels[stage]}</span>
      {index < wonStages.length - 1 ? <span className="hidden text-slate-300 sm:inline">—</span> : null}
    </div>)}
  </div>;
}

export function MarketingLeadCard({ lead, lifecycleStatus, notification, canManage }: { lead: MarketingLead; lifecycleStatus: LifecycleStatus; notification: LeadReadNotification | null; canManage: boolean }) {
  const systemControlled = lifecycleStatus === "CONVERTED" || lifecycleStatus === "COMPLETED";
  const badgeClass = lifecycleStatus === "NEW" ? "bg-orange-100 text-orange-800" : lifecycleStatus === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : lifecycleStatus === "CONVERTED" ? "bg-blue-100 text-blue-800" : lifecycleStatus === "CLOSED" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-800";
  return <article id={`lead-${lead.id}`} className="scroll-mt-24 target:ring-2 target:ring-orange-400 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <LeadReadControl notification={canManage ? notification : null} />
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black"><Link href={`/leads/${lead.id}`}>{lead.name}</Link></h2><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-black text-orange-700">{lead.source === "CONTACT" && lead.message === callClickMessage ? "Call click" : sourceLabels[lead.source]}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badgeClass}`}>{statusLabels[lifecycleStatus]}</span></div>
        <LifecycleRail status={lifecycleStatus} />
        {lead.source === "APPOINTMENT" && <section aria-label="Requested Appointment" className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <h3 className="text-sm font-black uppercase tracking-wide text-orange-900">Requested Appointment</h3>
          <p className="mt-3 text-xs font-bold text-orange-900">Requested date</p>
          <p className="mt-1 text-lg font-black text-slate-950">{lead.preferredDate ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(lead.preferredDate) : "Date not provided"}</p>
          <p className="mt-3 text-xs font-bold text-orange-900">Requested time</p>
          <p className="mt-1 text-lg font-black text-slate-950">{requestedTimeLabel(lead.preferredTime)}</p>
          <p className="mt-3 text-sm text-slate-700">This is the customer’s request, not a confirmed appointment. Use the separate Scheduled date and time controls to confirm scheduling.</p>
        </section>}
        {lead.phone && <p className="mt-3 text-lg font-black text-slate-950">{lead.phone}</p>}
        {lead.email && <p className="mt-1 text-sm font-semibold text-slate-600">{lead.email}</p>}
        {lead.preferredContactMethod && <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Preferred contact</p><p className="mt-1 text-base font-black text-slate-950">{leadContactMethodLabels[lead.preferredContactMethod]}</p></div>}
        {(lead.vehicleYear || lead.vehicleMake || lead.vehicleModel) && <p className="mt-4 text-base font-black text-slate-800">{[lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ")}</p>}
        {lead.source !== "APPOINTMENT" && (lead.preferredDate || lead.preferredTime) && <p className="mt-1 text-sm text-slate-600">Preferred: {lead.preferredDate?.toLocaleDateString() ?? "Date not provided"}{lead.preferredTime ? ` at ${lead.preferredTime}` : ""}</p>}
        {(lead.scheduledDate || lead.scheduledTime) && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800">Scheduled: {lead.scheduledDate?.toLocaleDateString() ?? "Date not provided"}{lead.scheduledTime ? ` at ${lead.scheduledTime}` : ""}</p>}
        {lead.requestedService && <div className="mt-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Requested service</p><p className="mt-1 font-bold">{lead.requestedService}</p></div>}
        {lead.message && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-600">{lead.message}</p>}
        <p className="mt-4 text-xs text-slate-400">Submitted {lead.createdAt.toLocaleString()}</p>
      </div>
      {canManage && <LeadManagementForm>
        <input type="hidden" name="id" value={lead.id} />
        {systemControlled ? <><input type="hidden" name="status" value={lead.status} /><div className={`rounded-lg px-3 py-3 text-sm font-bold ${lifecycleStatus === "COMPLETED" ? "bg-emerald-50 text-emerald-800" : "bg-blue-50 text-blue-800"}`}>{statusLabels[lifecycleStatus]}<p className="mt-1 text-xs font-medium">Set automatically {lifecycleStatus === "COMPLETED" ? "when the linked work is paid in full." : "when a repair order is created."}</p></div></> : <label className="text-xs font-black uppercase tracking-wider text-slate-500">Status<select aria-label={`Status for ${lead.name}`} name="status" defaultValue={lead.status} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-900">{manualStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>}
        <div className="grid grid-cols-2 gap-2"><label className="text-xs font-black uppercase tracking-wider text-slate-500">Scheduled date<input name="scheduledDate" type="date" defaultValue={lead.scheduledDate?.toISOString().slice(0, 10) ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900" /></label><label className="text-xs font-black uppercase tracking-wider text-slate-500">Time<input name="scheduledTime" type="time" defaultValue={lead.scheduledTime ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900" /></label></div>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Internal note<textarea name="internalNote" rows={3} maxLength={3000} defaultValue={lead.internalNote ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900" /></label>
      </LeadManagementForm>}
    </div>
  </article>;
}
