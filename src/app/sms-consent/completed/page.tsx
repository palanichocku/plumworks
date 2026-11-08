import type { Metadata } from "next";
export const metadata: Metadata = { title: "SMS Consent Response", robots: { index: false, follow: false } };
export default async function CompletedConsentPage({ searchParams }: { searchParams: Promise<{ consented?: string }> }) {
 const { consented } = await searchParams;
 return <main className="min-h-screen bg-slate-50 p-5 text-slate-950"><div className="mx-auto mt-12 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
  <h1 className="text-2xl font-bold">Thank you</h1><p className="mt-4 text-slate-700">{consented === "yes" ? "Your choice has been recorded. You may close this page and return the iPad to shop staff." : "Your choice has been recorded. You will not be enrolled in SMS updates through this form."}</p>
 </div></main>;
}
