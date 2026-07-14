import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceHistory } from "@/components/service-history";
import { getVehicleForCurrentShop } from "@/lib/data/vehicles";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vehicle = await getVehicleForCurrentShop(id);

  if (!vehicle) {
    notFound();
  }

  const description =
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
    "Unnamed vehicle";

  return (
    <>
      <Link
        href="/vehicles"
        className="text-sm font-semibold text-sky-700 hover:text-sky-800"
      >
        ← Vehicles
      </Link>
      <header className="mt-5">
        <p className="text-sm font-semibold uppercase tracking-wider text-sky-700">
          Vehicle
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          {description}
        </h1>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Vehicle details
          </h2>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
            <dt className="text-slate-500">Engine</dt>
            <dd className="text-slate-900">Not imported yet</dd>
            <dt className="text-slate-500">VIN</dt>
            <dd className="min-w-0 break-all text-slate-900">
              {vehicle.vin ?? "Not recorded"}
            </dd>
            <dt className="text-slate-500">License</dt>
            <dd className="text-slate-900">
              {vehicle.licensePlate ?? "Not recorded"}
            </dd>
            <dt className="text-slate-500">Odometer</dt>
            <dd className="text-slate-900">Not imported yet</dd>
            <dt className="text-slate-500">Legacy ID</dt>
            <dd className="text-slate-900">
              {vehicle.legacyCarno ?? "Not recorded"}
            </dd>
          </dl>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Customer</h2>
          <Link
            href={`/customers/${vehicle.customer.id}`}
            className="mt-5 block rounded-xl border border-slate-200 p-4 transition hover:border-sky-300 hover:bg-sky-50"
          >
            <p className="font-semibold text-slate-950">
              {vehicle.customer.displayName}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {vehicle.customer.phone ?? "No phone"}
            </p>
            <p className="mt-1 truncate text-sm text-slate-600">
              {vehicle.customer.email ?? "No email"}
            </p>
          </Link>
        </article>
      </section>
      <ServiceHistory invoices={vehicle.invoices} showCustomer />
    </>
  );
}
