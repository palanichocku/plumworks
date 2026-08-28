import Link from "next/link";
import { LoginForm } from "./login-form";
import { poweredByText, softwareBrandName } from "@/lib/branding";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Staff Login", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ passwordReset?: string }> }) {
  const resetComplete = (await searchParams).passwordReset === "1";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <Link
          href="/"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-primary text-sm font-bold text-white"
        >
          {softwareBrandName.charAt(0)}
        </Link>
        <p className="mt-8 text-sm font-semibold uppercase tracking-wider text-brand-primary">
          Welcome back
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          Sign in to your shop
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Enter your shop account credentials to continue.
        </p>
        <LoginForm />
        {resetComplete ? <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">Your password was updated. Sign in with the new password.</p> : null}
        <p className="mt-6 text-center text-xs leading-5 text-slate-500">
          Contact your administrator if you need access.
        </p>
        <p className="mt-4 border-t border-slate-100 pt-4 text-center text-xs font-medium text-slate-400">{poweredByText}</p>
      </section>
    </main>
  );
}
