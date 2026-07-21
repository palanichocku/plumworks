import Link from "next/link";
import { Pagination, parsePage } from "@/components/pagination";
import { PageHeading } from "@/components/page-heading";
import { getCustomersForCurrentShop } from "@/lib/data/customers";

type CustomersResult = Awaited<ReturnType<typeof getCustomersForCurrentShop>>;
type CustomerListItem = CustomersResult["customers"][number];

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

  const thClass = "px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 select-none";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Directory"
        title="Customers"
        description="Customer profiles assigned to your current shop workspace."
      />

      <form
        action="/customers"
        className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label htmlFor="customer-search" className="sr-only">
          Search customers by name or phone
        </label>
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Search by name or phone..."
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10"
        />
        <button
          type="submit"
          className="rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20"
        >
          Search
        </button>
      </form>

      {customers.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">
            {search ? "No matching records found" : "No customers yet"}
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            {search
              ? "Try checking spelling variables or phone formats."
              : "Customer records for this shop will appear here."}
          </p>
          {search && (
            <Link
              href="/customers"
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
              : "Showing the most recent customers"}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75">
                  <th className={thClass}>Name</th>
                  <th className={thClass}>Email</th>
                  <th className={thClass}>Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {customers.map((customer: CustomerListItem) => (
                  <tr key={customer.id} className="group transition-colors hover:bg-slate-50/60">
                    <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                      <Link href={`/customers/${customer.id}`} className="block hover:text-brand-primary transition-colors">
                        {customer.displayName}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600 font-medium">
                      {customer.email ?? <span className="text-slate-300 font-sans font-normal">No email</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600 font-medium">
                      {customer.phone ?? <span className="text-slate-300 font-sans font-normal">No phone</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      <Pagination
        pathname="/customers"
        page={page}
        hasNext={hasNext}
        search={search}
      />
    </div>
  );
}
