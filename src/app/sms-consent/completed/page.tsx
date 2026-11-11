import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SMS Preference Saved", robots: { index: false, follow: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CompletedConsentPage({ searchParams }: {
  searchParams: Promise<{ consented?: string; returnRoId?: string }>;
}) {
  const { consented, returnRoId } = await searchParams;
  let returnTo: string | null = null;
  // Never reveal an internal shop route to an unauthenticated customer phone.
  // The originating RO was already checked against the consent session before
  // redirect; confirm its shop and the staff session again on this page.
  if (returnRoId && UUID.test(returnRoId)) {
    const { user, membership } = await getCurrentMembership();
    if (user && membership) {
      const order = await prisma.repairOrder.findFirst({
        where: { id: returnRoId, shopId: membership.shopId },
        select: { id: true },
      });
      if (order) returnTo = `/repair-orders/${order.id}`;
    }
  }

  return <main className="min-h-screen bg-slate-100 px-5 py-12 text-slate-950">
    <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-800" aria-hidden="true">✓</div>
      <h1 className="mt-4 text-2xl font-bold">Thank you!</h1>
      <p className="mt-4 text-slate-700">
        {consented === "yes"
          ? "Your text message preference has been saved."
          : "Your choice has been recorded. You will not be enrolled in text messages through this request."}
      </p>
      {returnTo
        ? <>
            <Link href={returnTo}
              className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-base font-bold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
              Return to Repair Order
            </Link>
            <p className="mt-3 text-sm text-slate-600">Hand the iPad back to the shop to continue.</p>
          </>
        : <p className="mt-3 text-sm text-slate-600">You can now close this screen.</p>}
    </section>
  </main>;
}
