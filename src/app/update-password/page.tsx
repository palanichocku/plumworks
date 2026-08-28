import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { RECOVERY_CONTEXT_COOKIE } from "@/lib/auth/password-recovery";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Update Password", robots: { index: false, follow: false } };

export default async function UpdatePasswordPage() {
  const [cookieStore, supabase] = await Promise.all([cookies(), createClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  const validRecovery = cookieStore.get(RECOVERY_CONTEXT_COOKIE)?.value === "1" && Boolean(user);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Account recovery</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Choose a new password</h1>
        {validRecovery ? <><p className="mt-3 text-sm leading-6 text-slate-600">Use at least 12 characters. A password manager is recommended.</p><UpdatePasswordForm /></> : <><p className="mt-3 text-sm leading-6 text-slate-600">This password recovery link is invalid or has expired.</p><Link href="/forgot-password" className="mt-6 inline-flex text-sm font-medium text-brand-primary hover:underline">Request a new recovery link</Link></>}
      </section>
    </main>
  );
}
