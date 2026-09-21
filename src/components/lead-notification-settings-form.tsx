"use client";
import { useActionState } from "react";
import { updateLeadNotificationSettings } from "@/app/(app)/admin/shop-settings/actions";
import type { LeadNotificationSettings } from "@/lib/marketing-lead-notification-settings";

export function LeadNotificationSettingsForm({ settings }: { settings: LeadNotificationSettings & { marketingLeadInAppNotificationsEnabled: boolean } }) {
  const [state, action, pending] = useActionState(updateLeadNotificationSettings, {});
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-lg font-bold">Lead Notifications</h2>
    <p id="lead-notification-help" className="mt-2 max-w-2xl text-sm text-slate-600">Email notifications are independent of in-app notifications. Both configured addresses receive new Contact, Appointment, and Drop-Off requests.</p>
    <form action={action} aria-describedby="lead-notification-help" className="mt-5 max-w-2xl space-y-4">
      <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" name="marketingLeadInAppNotificationsEnabled" defaultChecked={settings.marketingLeadInAppNotificationsEnabled} />Show new lead notifications inside PlumWorks</label>
      <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" name="marketingLeadEmailNotificationsEnabled" defaultChecked={settings.marketingLeadEmailNotificationsEnabled} />Send email for new website leads</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Notification Email 1<input type="email" name="marketingLeadNotifyEmail1" maxLength={254} defaultValue={settings.marketingLeadNotifyEmail1 ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm font-semibold">Notification Email 2 <span className="font-normal text-slate-500">(optional)</span><input type="email" name="marketingLeadNotifyEmail2" maxLength={254} defaultValue={settings.marketingLeadNotifyEmail2 ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
      </div>
      <p className="text-sm text-slate-500">Leave both addresses blank to keep using the existing shop notification email.</p>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.saved && <p role="status" className="text-sm text-emerald-700">Lead notification settings saved.</p>}
      <button disabled={pending} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save Lead Notifications"}</button>
    </form>
  </section>;
}
