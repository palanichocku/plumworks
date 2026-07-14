import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceHistory } from "@/components/service-history";
import { getCustomerForCurrentShop } from "@/lib/data/customers";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomerForCurrentShop(id);

  if (!customer) {
    notFound();
  }

  return (
    <>
      <Link
        href="/customers"
        className="text-sm font-semibold text-sky-700 hover:text-sky-800"
      >
        ← Customers
      </Link>
      <header className="mt-5">
        <p className="text-sm font-semibold uppercase tracking-wider text-sky-700">
          Customer
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          {customer.displayName}
        </h1>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Contact details
          </h2>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
            <dt className="text-slate-500">Phone</dt>
            <dd className="text-slate-900">{customer.phone ?? "Not recorded"}</dd>
            <dt className="text-slate-500">Email</dt>
            <dd className="min-w-0 truncate text-slate-900">
              {customer.email ?? "Not recorded"}
            </dd>
            <dt className="text-slate-500">Legacy ID</dt>
            <dd className="text-slate-900">
              {customer.legacyCustno ?? "Not recorded"}
            </dd>
          </dl>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Address</h2>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            Not imported yet
          </p>
        </article>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-950">Vehicles</h2>
        </div>
        {customer.vehicles.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-600">
            No vehicles are linked to this customer.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {customer.vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-950">
                    {[vehicle.year, vehicle.make, vehicle.model]
                      .filter(Boolean)
                      .join(" ") || "Unnamed vehicle"}
                  </span>
                  <span className="text-sm text-slate-500">
                    {vehicle.licensePlate ?? "No plate"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ServiceHistory invoices={customer.invoices} showVehicle />
    </>
  );
}
