import Link from "next/link";
import { Pagination, parsePage } from "@/components/pagination";
import { PageHeading } from "@/components/page-heading";
import { getCustomersForCurrentShop } from "@/lib/data/customers";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page: pageParam, q } = await searchParams;
  const page = parsePage(pageParam);
  const search = q?.trim() ?? "";
  const { customers, hasNext } = await getCustomersForCurrentShop(search, page);

  return (
    <>
      <PageHeading
        eyebrow="Directory"
        title="Customers"
        description="Customer profiles assigned to your current shop."
      />

      <form
        action="/customers"
        className="mb-6 flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label htmlFor="customer-search" className="sr-only">
          Search customers by name or phone
        </label>
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Search by name or phone"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        />
        <button
          type="submit"
          className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700"
        >
          Search
        </button>
      </form>

      {customers.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">
            {search ? "No matching customers" : "No customers yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
            {search
              ? "Try a different name or phone number."
              : "Customer records for this shop will appear here."}
          </p>
          {search && (
            <Link
              href="/customers"
              className="mt-5 inline-block text-sm font-semibold text-sky-700 hover:text-sky-800"
            >
              Clear search
            </Link>
          )}
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-200">
            {customers.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  className="grid gap-2 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
                >
                  <p className="font-semibold text-slate-950">
                    {customer.displayName}
                  </p>
                  <p className="truncate text-sm text-slate-600">
                    {customer.email ?? "No email"}
                  </p>
                  <p className="text-sm text-slate-600">
                    {customer.phone ?? "No phone"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Pagination
        pathname="/customers"
        page={page}
        hasNext={hasNext}
        search={search}
      />
    </>
  );
}
