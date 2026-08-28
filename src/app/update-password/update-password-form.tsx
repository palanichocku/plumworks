"use client";

import { useActionState } from "react";
import { updatePasswordAction } from "./actions";
import type { PasswordRecoveryState } from "@/lib/auth/password-recovery";

const initialState: PasswordRecoveryState = { status: "idle" };

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initialState);
  return (
    <form action={action} className="mt-8 space-y-5">
      <label className="block"><span className="text-sm font-medium text-slate-700">New password</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-subtle" /></label>
      <label className="block"><span className="text-sm font-medium text-slate-700">Confirm new password</span><input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-subtle" /></label>
      {state.message ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{state.message}</p> : null}
      <button type="submit" disabled={pending} className="flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Updating…" : "Update password"}</button>
    </form>
  );
}
