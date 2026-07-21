import Link from "next/link";
import { Pagination, parsePage } from "@/components/pagination";
import { PageHeading } from "@/components/page-heading";
import { getVehiclesForCurrentShop } from "@/lib/data/vehicles";

type VehiclesResult = Awaited<ReturnType<typeof getVehiclesForCurrentShop>>;
type VehicleListItem = VehiclesResult["vehicles"][number];

export const dynamic = "force-dynamic";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page: pageParam, q } = await searchParams;
  const page = parsePage(pageParam);
  const search = q?.trim() ?? "";
  const { vehicles, hasNext } = await getVehiclesForCurrentShop(search, page);

  const thClass = "px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 select-none";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Directory"
        title="Vehicles"
        description="Active customer vehicles registered under your shop workspace."
      />

      <form
        action="/vehicles"
        className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label htmlFor="vehicle-search" className="sr-only">
          Search vehicles by make, model, or license plate
        </label>
        <input
          id="vehicle-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Search by make, model, license plate..."
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10"
        />
        <button
          type="submit"
          className="rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20"
        >
          Search
        </button>
      </form>

      {vehicles.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">
            {search ? "No matching vehicles found" : "No vehicles registered"}
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            {search
              ? "Try adjusting search fields or clear filters to look wider."
              : "Vehicle profiles created in repair orders automatically catalog here."}
          </p>
          {search && (
            <Link
              href="/vehicles"
              className="mt-4 inline-block text-xs font-bold uppercase tracking-wider text-brand-primary hover:text-brand-primary"
            >
              Clear filter view
            </Link>
          )}
        </section>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-3 text-xs font-medium text-slate-400 italic">
            {search
              ? `Showing localized sequence results matching “${search}”`
              : "Showing the most recent vehicles"}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75">
                  <th className={thClass}>Make</th>
                  <th className={thClass}>Model</th>
                  <th className={thClass}>Year</th>
                  <th className={thClass}>License Plate</th>
                  <th className={thClass}>VIN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {vehicles.map((vehicle: VehicleListItem) => (
                  <tr key={vehicle.id} className="group transition-colors hover:bg-slate-50/60">
                    <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                      <Link href={`/vehicles/${vehicle.id}`} className="block hover:text-brand-primary transition-colors">
                        {vehicle.make ?? "Unknown Make"}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                      {vehicle.model ?? "Unknown Model"}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 font-medium">
                      {vehicle.year ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600 font-mono font-medium tracking-tight">
                      {vehicle.licensePlate ?? <span className="text-slate-300 font-sans font-normal">Not recorded</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-400 font-mono select-all">
                      {vehicle.vin ?? <span className="text-slate-300 font-sans font-normal">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      <Pagination
        pathname="/vehicles"
        page={page}
        hasNext={hasNext}
        search={search}
      />
    </div>
  );
}
