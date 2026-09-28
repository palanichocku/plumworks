"use client";

import { useActionState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { ShopMembershipRole } from "@/generated/prisma/client";
import type { createStaffInvite, StaffInviteActionState } from "./actions";

type InviteAction = typeof createStaffInvite;
const initialState: StaffInviteActionState = { status: "idle" };

export function StaffInviteForm({
  action,
  roleOptions,
}: {
  action: InviteAction;
  roleOptions: ShopMembershipRole[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10";

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wider text-slate-500">
        Email address
        <input name="email" type="email" required maxLength={254} placeholder="mechanic@example.com" className={inputClass} />
      </label>
      <label className="w-full text-xs font-bold uppercase tracking-wider text-slate-500 sm:w-48">
        Initial Role
        <select name="role" defaultValue="STAFF" className={inputClass}>
          {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      </label>
      <FormSubmitButton pendingLabel="Sending invitation…" className="whitespace-nowrap rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-brand-primary disabled:opacity-50">
        Send Invite
      </FormSubmitButton>
      {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-red-700" : "text-emerald-700"}`}>{state.message}</p> : null}
      {pending ? <span className="sr-only" aria-live="polite">Sending invitation</span> : null}
    </form>
  );
}
