import Link from "next/link";
import { MarketingLeadStatus, type MarketingLead } from "@/generated/prisma/client";
import { LeadManagementForm } from "@/components/lead-management-form";
import { callClickMessage } from "@/lib/marketing-lead-context";
import { LeadReadControl, type LeadReadNotification } from "@/components/lead-read-control";

const statusLabels = { NEW: "New", CONTACTED: "Contacted", SCHEDULED: "Scheduled", CONVERTED: "Converted", COMPLETED: "Completed", CLOSED: "Lost" } as const;
const sourceLabels = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" } as const;
const manualStatuses = [MarketingLeadStatus.NEW, MarketingLeadStatus.CONTACTED, MarketingLeadStatus.SCHEDULED, MarketingLeadStatus.CLOSED] as const;
type LifecycleStatus = keyof typeof statusLabels;
const wonStages: LifecycleStatus[] = ["NEW", "CONTACTED", "SCHEDULED", "CONVERTED", "COMPLETED"];

function timeLabel(time: string | null) {
  if (!time) return null;
  const [hour, minute] = time.split(":");
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) >= 12 ? "PM" : "AM"}`;
}

function shortDate(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(value);
}

function compactRequestedDate(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(value);
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

function MessageIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /></svg>;
}

function PhoneIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.08 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92Z" /></svg>;
}

function EmailIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}

function CalendarIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
}

function ContactPreference({ preferred }: { preferred: MarketingLead["preferredContactMethod"] }) {
  if (!preferred) return null;
  const textPreferred = preferred === "TEXT";
  const callPreferred = preferred === "PHONE_CALL";
  const emailPreferred = preferred === "EMAIL";
  const secondary = "border-slate-300 bg-slate-50 text-slate-500";
  const primary = "border-brand-primary bg-brand-primary text-white";
  return <div className="flex flex-wrap items-center gap-2 sm:justify-end">
    <span className="mr-1 text-xs font-black uppercase tracking-wide text-slate-500">Preferred</span>
    <span className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black ${textPreferred ? primary : secondary}`}><MessageIcon />Text</span>
    <span className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black ${callPreferred ? primary : secondary}`}><PhoneIcon />Call</span>
    <span className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black ${emailPreferred ? primary : secondary}`}><EmailIcon />Email</span>
  </div>;
}

export function MarketingLeadCard({ lead, lifecycleStatus, notification, canManage }: { lead: MarketingLead; lifecycleStatus: LifecycleStatus; notification: LeadReadNotification | null; canManage: boolean }) {
  const systemControlled = lifecycleStatus === "CONVERTED" || lifecycleStatus === "COMPLETED";
  const badgeClass = lifecycleStatus === "NEW" ? "bg-orange-100 text-orange-800" : lifecycleStatus === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : lifecycleStatus === "CONVERTED" ? "bg-blue-100 text-blue-800" : lifecycleStatus === "CLOSED" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-800";
  const vehicle = [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ") || "Not provided";
  const scheduled = lead.scheduledDate || lead.scheduledTime;
  const requestedDate = compactRequestedDate(lead.preferredDate);
  const requestedTime = timeLabel(lead.preferredTime);
  const scheduledDate = shortDate(lead.scheduledDate);
  const scheduledTime = timeLabel(lead.scheduledTime);
  const submitted = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(lead.createdAt);

  return <article id={`lead-${lead.id}`} className="scroll-mt-24 target:ring-2 target:ring-orange-400 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <LeadReadControl notification={canManage ? notification : null} />
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black"><Link href={`/leads/${lead.id}`}>{lead.name}</Link></h2><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-black text-orange-700">{lead.source === "CONTACT" && lead.message === callClickMessage ? "Call click" : sourceLabels[lead.source]}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badgeClass}`}>{statusLabels[lifecycleStatus]}</span></div>
        <LifecycleRail status={lifecycleStatus} />

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {lead.phone && <p className="text-2xl font-black tracking-tight text-slate-950">{lead.phone}</p>}
            {lead.email && <p className="mt-1 break-all text-base font-medium text-slate-700">{lead.email}</p>}
          </div>
          <ContactPreference preferred={lead.preferredContactMethod} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 px-4 py-3.5">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">Vehicle</p>
            <p className="mt-1 text-lg font-black text-slate-950">{vehicle}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3.5">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">Requested service</p>
            <p className="mt-1 text-lg font-black text-slate-950">{lead.requestedService || "Not provided"}</p>
          </div>
        </div>

        {scheduled ? <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3.5 font-black text-slate-700"><CalendarIcon /><span>Was scheduled: {scheduledDate ?? "Date not provided"}{scheduledTime ? ` at ${scheduledTime}` : ""}</span></div> : null}

        <p className="mt-5 text-sm leading-6 text-slate-600">
          {lead.preferredDate || lead.preferredTime ? <>Customer requested {requestedDate ?? "a date not provided"}{requestedTime ? ` at ${requestedTime}` : ""}. </> : null}
          Submitted {submitted} from the website {sourceLabels[lead.source].toLowerCase()} form.
        </p>
        {lead.message && lead.message !== callClickMessage ? <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-600">{lead.message}</p> : null}
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
