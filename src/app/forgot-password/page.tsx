import Link from "next/link";
import type { Metadata } from "next";
import { RecoveryRequestForm } from "./recovery-request-form";

export const metadata: Metadata = { title: "Recover Password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Account recovery</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Reset your password</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Enter your staff login email. Recovery instructions will be sent if the account exists.</p>
        <RecoveryRequestForm />
        <Link href="/login" className="mt-6 block text-center text-sm font-medium text-brand-primary hover:underline">Return to sign in</Link>
      </section>
    </main>
  );
}
