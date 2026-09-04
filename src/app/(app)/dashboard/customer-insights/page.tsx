import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { getCurrentMonthCustomerActivity } from "@/lib/data/customer-activity";
import { formatDate, formatMoney } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function CustomerInsightsPage({ searchParams }: { searchParams: Promise<{ segment?: string }> }) {
  const activity = await getCurrentMonthCustomerActivity();
  const segment = (await searchParams).segment === "new" ? "new" : "returning";
  if (!activity) return <div className="space-y-6"><PageHeading eyebrow="Owner insights" title="Customer Activity" description="No shop membership found." /></div>;
  const rows = segment === "returning" ? activity.returning : activity.newCustomers;
  const emptyMessage = segment === "returning" ? "No returning customers serviced this month." : "No new customers serviced this month.";
  const thClass = "px-5 py-4 text-xs font-extrabold uppercase tracking-widest text-slate-700";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading eyebrow="Owner insights" title="Customer Activity" description="Customers serviced this month" />
      <nav aria-label="Customer activity segment" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        <Link href="/dashboard/customer-insights?segment=returning" aria-current={segment === "returning" ? "page" : undefined} className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold ${segment === "returning" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Returning ({activity.returningCustomers})</Link>
        <Link href="/dashboard/customer-insights?segment=new" aria-current={segment === "new" ? "page" : undefined} className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold ${segment === "new" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>New ({activity.newCustomerCount})</Link>
      </nav>

      {rows.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">{emptyMessage}</h2>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead><tr className="border-b-2 border-slate-200 bg-slate-100/80">
                <th className={thClass}>Customer</th><th className={thClass}>Vehicles</th><th className={thClass}>Visits This Month</th><th className={thClass}>Sales This Month</th><th className={thClass}>{segment === "returning" ? "Last Prior Visit" : "First Visit"}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => <tr key={row.customerId} className="transition-colors hover:bg-slate-50/60">
                  <td className="px-5 py-4 text-sm font-bold text-slate-900"><Link href={`/customers/${row.customerId}`} className="hover:text-brand-primary">{row.customerName}</Link></td>
                  <td className="px-5 py-4 text-sm font-medium text-slate-600">{row.vehicleCount}</td>
                  <td className="px-5 py-4 text-sm font-medium text-slate-600">{row.visitsThisMonth}</td>
                  <td className="px-5 py-4 text-sm font-black text-slate-900">{formatMoney(row.salesThisMonth)}</td>
                  <td className="px-5 py-4 text-sm font-medium text-slate-600">{formatDate(segment === "returning" ? row.lastPriorVisit : row.firstVisitThisMonth)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Link href="/dashboard" className="inline-flex text-sm font-semibold text-brand-primary hover:underline">← Back to Dashboard</Link>
    </div>
  );
}
