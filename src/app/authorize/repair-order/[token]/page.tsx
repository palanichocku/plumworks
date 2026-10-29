import type { Metadata } from "next";
import { getPublicRepairOrderAuthorization, REMOTE_AUTHORIZATION_CONSENT_TEXT } from "@/lib/authorization/remote-repair-order-authorization";
import { submitRepairOrderAuthorization } from "@/app/authorize/repair-order/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function money(value: string | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "$0.00";
}

const errorMessages: Record<string, string> = {
  name: "Please enter the full name of the person making this decision.",
  consent: "Please confirm the authorization statement before submitting.",
  expired: "This approval link has expired. Please contact the shop for a new link.",
  revoked: "This approval link has been revoked. Please contact the shop for a new link.",
  superseded: "This Repair Order changed after this link was issued. Please contact the shop for a new approval link.",
  invalid: "This approval link is invalid.",
  decision: "Please choose Approve or Decline.",
};

export default async function RepairOrderAuthorizationPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; completed?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const request = await getPublicRepairOrderAuthorization(token);

  if (!request) return <PublicShell><StatusCard title="Approval link unavailable" body="This link is invalid or no longer available. Please contact the repair shop." /></PublicShell>;

  const snapshot = request.snapshot;
  const shopName = snapshot.shop?.name || "Repair Shop";
  const vehicle = [snapshot.vehicle?.year, snapshot.vehicle?.make, snapshot.vehicle?.model].filter(Boolean).join(" ") || "Vehicle";
  const status = request.effectiveStatus;
  const completed = query.completed === "approved" || query.completed === "declined";

  if (completed || status === "APPROVED" || status === "DECLINED") {
    const approved = status === "APPROVED" || query.completed === "approved";
    return <PublicShell>
      <StatusCard
        title={approved ? "Repair Order approved" : "Repair Order declined"}
        body={approved ? `Thank you. Your approval for Repair Order #${snapshot.repairOrder?.number ?? request.revision} has been recorded.` : `Your decline for Repair Order #${snapshot.repairOrder?.number ?? request.revision} has been recorded. The shop can follow up with you about next steps.`}
      />
      <ShopFooter shop={snapshot.shop} />
    </PublicShell>;
  }

  if (status !== "PENDING") {
    const body = status === "EXPIRED"
      ? "This approval link has expired. Please contact the shop for a new link."
      : status === "SUPERSEDED"
        ? "This Repair Order changed after this link was issued, so the link can no longer be used. Please contact the shop for an updated approval request."
        : "This approval link is no longer active. Please contact the shop.";
    return <PublicShell><StatusCard title="Approval link no longer active" body={body} /><ShopFooter shop={snapshot.shop} /></PublicShell>;
  }

  return <PublicShell>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Customer Authorization</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">Repair Order #{snapshot.repairOrder?.number ?? request.revision}</h1>
      <p className="mt-2 text-sm text-slate-600">Please review the exact work and total below before approving or declining.</p>
      <dl className="mt-5 grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="font-semibold text-slate-600">Shop</dt><dd className="text-slate-900">{shopName}</dd>
        <dt className="font-semibold text-slate-600">Customer</dt><dd className="text-slate-900">{snapshot.customer?.displayName || "Customer"}</dd>
        <dt className="font-semibold text-slate-600">Vehicle</dt><dd className="text-slate-900">{vehicle}</dd>
        {snapshot.repairOrder?.odometer != null ? <><dt className="font-semibold text-slate-600">Mileage</dt><dd className="text-slate-900">{snapshot.repairOrder.odometer.toLocaleString()}</dd></> : null}
      </dl>
    </section>

    {snapshot.repairOrder?.customerComplaint || snapshot.repairOrder?.recommendation ? <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-lg font-bold text-slate-950">Concerns &amp; recommendations</h2>
      {snapshot.repairOrder.customerComplaint ? <div className="mt-4"><h3 className="text-sm font-semibold text-slate-700">Customer concern</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{snapshot.repairOrder.customerComplaint}</p></div> : null}
      {snapshot.repairOrder.recommendation ? <div className="mt-4"><h3 className="text-sm font-semibold text-slate-700">Recommended work</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{snapshot.repairOrder.recommendation}</p></div> : null}
    </section> : null}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-lg font-bold text-slate-950">Parts &amp; labor</h2>
      <div className="mt-4 space-y-3">
        {(snapshot.parts ?? []).map((part, index) => <div key={`part-${index}`} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 text-sm"><div><p className="font-semibold text-slate-900">{part.description || "Part"}</p><p className="mt-1 text-slate-500">Qty {part.quantity ?? "0"} × {money(part.unitPrice)}</p></div><p className="font-semibold text-slate-900">{money(part.lineTotal)}</p></div>)}
        {(snapshot.labor ?? []).map((line, index) => <div key={`labor-${index}`} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 text-sm"><div><p className="font-semibold text-slate-900">{line.description || "Labor"}</p><p className="mt-1 text-slate-500">{line.complimentary ? "Complimentary" : `${line.hours ?? "0"} hr × ${money(line.hourlyRate)}`}</p></div><p className="font-semibold text-slate-900">{money(line.lineTotal)}</p></div>)}
        {(snapshot.parts ?? []).length === 0 && (snapshot.labor ?? []).length === 0 ? <p className="text-sm text-slate-600">No line items are listed.</p> : null}
      </div>
      <dl className="ml-auto mt-6 max-w-sm space-y-2 text-sm">
        <div className="flex justify-between"><dt className="text-slate-600">Parts</dt><dd>{money(snapshot.totals?.parts)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-600">Labor</dt><dd>{money(snapshot.totals?.labor)}</dd></div>
        {Number(snapshot.totals?.shopSupplies ?? 0) !== 0 ? <div className="flex justify-between"><dt className="text-slate-600">Shop supplies</dt><dd>{money(snapshot.totals?.shopSupplies)}</dd></div> : null}
        <div className="flex justify-between"><dt className="text-slate-600">Tax</dt><dd>{money(snapshot.totals?.tax)}</dd></div>
        <div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><dt>Total</dt><dd>{money(snapshot.totals?.total)}</dd></div>
      </dl>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-lg font-bold text-slate-950">Your decision</h2>
      {query.error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{errorMessages[query.error] ?? "Your decision could not be recorded. Please try again."}</p> : null}
      <form action={submitRepairOrderAuthorization} className="mt-5 space-y-5">
        <input type="hidden" name="token" value={token} />
        <label className="block text-sm font-semibold text-slate-700">Full name of person authorizing
          <input name="authorizerName" required minLength={2} maxLength={120} autoComplete="name" defaultValue={snapshot.customer?.displayName || ""} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10" />
        </label>
        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          <input type="checkbox" name="consent" value="yes" required defaultChecked className="mt-1 h-4 w-4" />
          <span>{REMOTE_AUTHORIZATION_CONSENT_TEXT}</span>
        </label>
        <p className="text-xs leading-5 text-slate-500">Your decision, name, date/time, browser information, and network address are recorded as authorization evidence for this exact Repair Order revision.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="submit" name="decision" value="DECLINED" className="rounded-lg border border-red-300 bg-white px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-50">Decline</button>
          <button type="submit" name="decision" value="APPROVED" className="rounded-lg bg-brand-primary px-4 py-3 text-sm font-bold text-white hover:bg-brand-primary">Approve Repair Order</button>
        </div>
      </form>
    </section>
    <ShopFooter shop={snapshot.shop} />
  </PublicShell>;
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:py-12"><div className="mx-auto max-w-3xl space-y-5">{children}</div></main>;
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h1 className="text-2xl font-bold text-slate-950">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-700">{body}</p></section>;
}

function ShopFooter({ shop }: { shop: { name?: string; addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; phone?: string | null } | undefined }) {
  if (!shop) return null;
  const address = [shop.addressLine1, [shop.city, shop.state, shop.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  return <footer className="px-2 py-4 text-center text-xs leading-5 text-slate-500"><p className="font-semibold text-slate-700">{shop.name}</p>{address ? <p>{address}</p> : null}{shop.phone ? <p>{shop.phone}</p> : null}</footer>;
}
