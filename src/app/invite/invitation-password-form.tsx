"use client";

import { type FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptStaffInvite } from "./actions";

export function InvitationPasswordForm({ inviteId }: { inviteId: string }) {
  const [passwordSet, setPasswordSet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function setPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password") ?? "");
    const confirmation = String(values.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("Password confirmation does not match.");
      setPending(false);
      return;
    }
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError("The password could not be set. Request a new invitation or contact your administrator.");
      } else {
        setPasswordSet(true);
      }
    } catch {
      setError("The password could not be set. Request a new invitation or contact your administrator.");
    }
    setPending(false);
  }

  if (passwordSet) {
    return <form action={acceptStaffInvite} className="mt-6">
      <input type="hidden" name="inviteId" value={inviteId} />
      <button type="submit" className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Accept Invite</button>
    </form>;
  }

  return <form onSubmit={setPassword} className="mt-6 space-y-4 text-left">
    <label className="block text-sm font-medium text-slate-700">Choose password
      <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-subtle" />
    </label>
    <label className="block text-sm font-medium text-slate-700">Confirm password
      <input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-subtle" />
    </label>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p> : null}
    <button type="submit" disabled={pending} className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Setting password…" : "Set password"}</button>
    <p className="text-xs text-slate-500">Your password is sent directly to Supabase Auth and is never stored by PlumWorks.</p>
  </form>;
}
