"use client";

import { type FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { requestPasswordRecovery } from "@/lib/auth/password-recovery";

export function RecoveryRequestForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    const result = await requestPasswordRecovery(createClient(), email, window.location.origin);
    setMessage(result);
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input name="email" type="email" autoComplete="email" required maxLength={254} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-subtle" />
      </label>
      {message ? <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">{message}</p> : null}
      <button type="submit" disabled={pending} className="flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Sending…" : "Send recovery instructions"}
      </button>
    </form>
  );
}
