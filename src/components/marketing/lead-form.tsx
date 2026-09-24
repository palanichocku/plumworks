import type { MarketingLeadSource } from "@/generated/prisma/client";
import { submitContactLead, submitAppointmentLead, submitDropOffLead } from "@/app/(marketing)/lead-actions";

import { leadContactMethodLabels } from "@/lib/marketing-lead-contact";
import { requestedServices, leadFormHelper } from "@/lib/marketing-requested-services";
import { createFormStarted } from "@/lib/public-lead-verification";
import { LeadVerification } from "@/components/marketing/lead-verification";

const actions = { CONTACT: submitContactLead, APPOINTMENT: submitAppointmentLead, DROP_OFF: submitDropOffLead } as const;

export function LeadForm({ source, sent = false, error = false }: { source: MarketingLeadSource; sent?: boolean; error?: boolean | string }) {
  const appointment = source === "APPOINTMENT";
  const dropOff = source === "DROP_OFF";
  const formStarted = createFormStarted(source);
  const input = "mt-1.5 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10";
  if (sent) return <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900"><p className="font-bold">{appointment ? "Thanks — your appointment request was sent. The shop will contact you to confirm the date and time." : "Thanks — your request was sent. The shop will contact you soon."}</p>{appointment && <p className="mt-1 text-sm">This is not a confirmed appointment yet.</p>}{dropOff && <p className="mt-3 font-bold">Wait for confirmation and approved drop-off instructions before leaving keys or a vehicle.</p>}</div>;
  return <form action={actions[source]} className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 sm:p-8">
    <p className="text-sm leading-6 text-slate-600 sm:col-span-2">{leadFormHelper}</p>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800 sm:col-span-2">{error === "verification" ? "We couldn’t verify your request. Please complete the verification again and retry, or call the shop." : "We couldn’t send your request right now. Please review your details and try again shortly, or call the shop."}</div>}
    <input type="hidden" name="formStarted" value={formStarted} />
    <label className="text-sm font-bold text-slate-700">Name *<input name="name" required maxLength={120} className={input} /></label>
    <label className="text-sm font-bold text-slate-700">Phone *<input name="phone" type="tel" required maxLength={40} className={input} /></label>
    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Email *<input name="email" type="email" required maxLength={200} className={input} /></label>
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-bold text-slate-700">Preferred contact method *</legend>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">{Object.entries(leadContactMethodLabels).map(([method, label]) => <label key={method} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="radio" name="preferredContactMethod" value={method} required className="h-4 w-4 accent-orange-500" />{label}</label>)}</div>
    </fieldset>
    {(appointment || dropOff) && <>
      <label className="text-sm font-bold text-slate-700">Vehicle year *<input name="vehicleYear" required type="number" min="1900" max={new Date().getUTCFullYear() + 2} className={input} /></label>
      <label className="text-sm font-bold text-slate-700">Vehicle make *<input name="vehicleMake" required maxLength={80} className={input} /></label>
      <label className="text-sm font-bold text-slate-700">Vehicle model *<input name="vehicleModel" required maxLength={80} className={input} /></label>
      <label className="min-w-0 text-sm font-bold text-slate-700">{dropOff ? "Preferred drop-off date *" : "Preferred date *"}<input name="preferredDate" required type="date" className={input} /></label>
      {appointment && <label className="min-w-0 text-sm font-bold text-slate-700">Preferred time <span className="font-normal text-slate-400">(optional)</span><input name="preferredTime" type="time" className={input} /></label>}
    </>}
    <div className="min-w-0 text-sm font-bold text-slate-700 sm:col-span-2"><label htmlFor="requested-service">Requested service *</label><select id="requested-service" name="requestedService" required defaultValue="" className={input}><option value="" disabled>Choose a service</option>{requestedServices.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></div>
    <LeadVerification source={source} key={formStarted} />
  </form>;
}
