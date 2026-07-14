import { PageHeading } from "@/components/page-heading";
import { getCurrentMembership } from "@/lib/data/membership";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { membership } = await getCurrentMembership();
  const shop = membership?.shop;
  const role = membership
    ? membership.role.charAt(0) + membership.role.slice(1).toLowerCase()
    : null;

  return (
    <>
      <PageHeading
        eyebrow="Overview"
        title="Dashboard"
        description="Your connected Car Doc shop workspace."
      />

      {shop ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-sky-700">
                Your shop
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                {shop.name}
              </h2>
              <address className="mt-5 space-y-1 text-sm not-italic leading-6 text-slate-600">
                {shop.addressLine1 && <p>{shop.addressLine1}</p>}
                {(shop.city || shop.state || shop.postalCode) && (
                  <p>
                    {[shop.city, shop.state].filter(Boolean).join(", ")}
                    {shop.postalCode ? ` ${shop.postalCode}` : ""}
                  </p>
                )}
                {shop.phone && (
                  <p>
                    <a
                      href={`tel:${shop.phone}`}
                      className="font-medium text-slate-800 hover:text-sky-700"
                    >
                      {shop.phone}
                    </a>
                  </p>
                )}
              </address>
            </div>

            <div className="space-y-3 sm:text-right">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Database connected
              </div>
              <p className="text-sm text-slate-600">
                Role:{" "}
                <span className="font-semibold text-slate-900">{role}</span>
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">
            No shop membership found
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
            Your account is not currently connected to a shop.
          </p>
        </section>
      )}
    </>
  );
}
