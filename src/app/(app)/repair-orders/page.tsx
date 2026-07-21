import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { getOpenOrdersForCurrentShop } from "@/lib/data/open-orders";
import { formatDate, formatMoney } from "@/lib/formatters";
import { DeleteRepairOrderButton } from "@/components/delete-repair-order-button";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

type RepairOrder = Awaited<
  ReturnType<typeof getOpenOrdersForCurrentShop>
>[number];

export const dynamic = "force-dynamic";

export default async function RepairOrdersPage() {
  const [orders, { membership }] = await Promise.all([
    getOpenOrdersForCurrentShop(),
    getCurrentMembership()
  ]);
  const canDelete = Boolean(membership && hasPermission(membership.role, "delete_draft_repair_order"));

  const thClass = "px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 select-none";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Dynamic Header Strip Frame */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeading 
          eyebrow="Work in progress" 
          title="Repair Orders" 
          description="Active garage floor repair orders and drafts that have not been finalized as invoices." 
        />
        <Link 
          href="/repair-orders/new" 
          className="self-start sm:self-auto rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20"
        >
          New Repair Order
        </Link>
      </div>

      {/* Main Stream Display Logic */}
      {orders.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">No active repair orders</h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            Open garage tickets and staging repair drafts for this shop will appear here.
          </p>
        </section>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Informational Sub-Panel matching Invoices layout exactly */}
          <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-3 text-xs font-medium text-slate-400 italic">
            Showing the most recent open repair orders
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75">
                  <th className={thClass}>RO # / Date</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Vehicle</th>
                  <th className={thClass}>Status / Scope</th>
                  <th className={thClass}>Estimated Total</th>
                  <th className={`${thClass} text-right pr-6`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {orders.map((order: RepairOrder) => {
                  const imported = Boolean(order.legacySourceTable);
                  const vehicleDescription = [order.vehicle.year, order.vehicle.make, order.vehicle.model]
                    .filter(Boolean)
                    .join(" ") || "Vehicle details unavailable";

                  return (
                    <tr key={order.id} className="group transition-colors hover:bg-slate-50/60">
                      {/* RO Reference Target */}
                      <td className="px-5 py-3.5 text-sm">
                        <Link 
                          href={imported ? `/open-orders/${order.id}` : `/repair-orders/${order.id}`} 
                          className="block font-bold text-slate-900 hover:text-brand-primary transition-colors"
                        >
                          RO #{order.repairOrderNumber ?? order.legacyRoNo ?? "Draft"}
                        </Link>
                        <span className="block text-xs font-medium text-slate-400 mt-0.5">
                          {formatDate(order.openedAt)}
                        </span>
                      </td>

                      {/* Profile Subject Name */}
                      <td className="px-5 py-3.5 text-sm font-semibold text-slate-700 truncate max-w-[160px]">
                        {order.customer.displayName}
                      </td>

                      {/* Asset Registry Attributes */}
                      <td className="px-5 py-3.5 text-sm text-slate-500 font-medium truncate max-w-[200px]">
                        {vehicleDescription}
                      </td>

                      {/* Operational Phase Flags */}
                      <td className="px-5 py-3.5 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${
                            imported 
                              ? "bg-amber-50 text-amber-700 border-amber-200 shadow-2xs" 
                              : "bg-brand-subtle text-brand-primary border-brand-primary/30 shadow-2xs"
                          }`}>
                            {order.status}{imported ? " · Read Only" : ""}
                          </span>
                        </div>
                        <span className="block text-xs font-medium text-slate-400 mt-1">
                          {order._count.parts} parts · {order._count.labor} labor items
                        </span>
                      </td>

                      {/* Cumulative Pricing Matrix */}
                      <td className="px-5 py-3.5 text-sm font-black text-slate-900">
                        {formatMoney(order.estimatedTotal)}
                      </td>

                      {/* Structural Row Trailing Context Button Elements */}
                      <td className="px-5 py-3.5 text-right pr-6 whitespace-nowrap">
                        {!imported && canDelete ? (
                          <div className="inline-block opacity-60 group-hover:opacity-100 transition-opacity">
                            <DeleteRepairOrderButton repairOrderId={order.id} compact />
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-slate-300 select-none cursor-default">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
