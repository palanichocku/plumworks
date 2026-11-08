import type { Metadata } from "next";
export const metadata: Metadata = { title: "SMS Preference Saved", robots: { index: false, follow: false } };
export default async function CompletedConsentPage({ searchParams }: { searchParams: Promise<{ consented?: string }> }) {
  const { consented } = await searchParams;
  return <main className="min-h-screen bg-slate-100 px-5 py-12 text-slate-950">
    <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-800" aria-hidden="true">✓</div>
      <h1 className="mt-4 text-2xl font-bold">Thank you!</h1>
      <p className="mt-4 text-slate-700">
        {consented === "yes"
          ? "Your text message preference has been saved."
          : "Your choice has been recorded. You will not be enrolled in text messages through this request."}
      </p>
      <p className="mt-3 text-sm text-slate-600">You can now close this screen.</p>
    </section>
  </main>;
}
