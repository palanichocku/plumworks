import type { MarketingLeadSource } from "@/generated/prisma/client";
import { submitContactLead, submitAppointmentLead, submitDropOffLead } from "@/app/(marketing)/lead-actions";

const actions = { CONTACT: submitContactLead, APPOINTMENT: submitAppointmentLead, DROP_OFF: submitDropOffLead } as const;

export function LeadForm({ source, sent = false, error = false }: { source: MarketingLeadSource; sent?: boolean; error?: boolean }) {
  const appointment = source === "APPOINTMENT";
  const dropOff = source === "DROP_OFF";
  const input = "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10";
  if (sent) return <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900"><p className="font-bold">Thanks — your request was sent. The shop will contact you soon.</p><p className="mt-1 text-sm">This is not a confirmed appointment yet.</p></div>;
  return <form action={actions[source]} className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 sm:p-8">
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800 sm:col-span-2">We couldn’t send your request right now. Please review your contact details or call the shop.</div>}
    <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
    <label className="text-sm font-bold text-slate-700">Name *<input name="name" required maxLength={120} className={input} /></label>
    <label className="text-sm font-bold text-slate-700">Phone<input name="phone" type="tel" maxLength={40} className={input} /></label>
    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Email<input name="email" type="email" maxLength={200} className={input} /><span className="mt-1 block text-xs font-normal text-slate-500">Provide a phone number, email, or both.</span></label>
    {(appointment || dropOff) && <>
      <label className="text-sm font-bold text-slate-700">Vehicle year<input name="vehicleYear" type="number" min="1900" max="2100" className={input} /></label>
      <label className="text-sm font-bold text-slate-700">Vehicle make<input name="vehicleMake" maxLength={80} className={input} /></label>
      <label className="text-sm font-bold text-slate-700">Vehicle model<input name="vehicleModel" maxLength={80} className={input} /></label>
      <label className="text-sm font-bold text-slate-700">Preferred date<input name="preferredDate" type="date" className={input} /></label>
    </>}
    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Requested service<input name="requestedService" maxLength={200} placeholder="What can we help with?" className={input} /></label>
    <label className="text-sm font-bold text-slate-700 sm:col-span-2">{dropOff ? "Drop-off notes" : "Message"}<textarea name="message" rows={5} maxLength={3000} className={input} placeholder={dropOff ? "Describe the concern and any timing or key handoff details. Do not include sensitive information." : "Share symptoms, questions, or scheduling needs."} /></label>
    <div className="sm:col-span-2"><button className="w-full rounded-xl bg-orange-500 px-5 py-3.5 text-sm font-black text-white shadow-sm hover:bg-orange-600">Send {dropOff ? "Drop-Off" : appointment ? "Appointment" : "Contact"} Request</button><p className="mt-3 text-center text-xs text-slate-500">Submitting a request does not guarantee a time. The shop will confirm availability.</p></div>
  </form>;
}
