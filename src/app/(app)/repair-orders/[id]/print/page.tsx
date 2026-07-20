import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getWebRepairOrderForCurrentShop } from "@/lib/data/repair-orders";
import { formatDate, formatMoney } from "@/lib/formatters";

type PrintableOrder = NonNullable<
  Awaited<ReturnType<typeof getWebRepairOrderForCurrentShop>>
>;
type PrintablePart = PrintableOrder["parts"][number];
type PrintableLabor = PrintableOrder["labor"][number];

export const dynamic = "force-dynamic";

export default async function PrintableRepairOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getWebRepairOrderForCurrentShop(id);
  if (!order) notFound();

  const shopLocality = [order.shop.city, order.shop.state, order.shop.postalCode]
    .filter(Boolean)
    .join(", ");
  const customerLocality = [
    order.customer.city,
    order.customer.state,
    order.customer.postalCode,
  ].filter(Boolean).join(", ");
  const vehicle = [order.vehicle.year, order.vehicle.make, order.vehicle.model]
    .filter(Boolean)
    .join(" ") || "Vehicle details unavailable";
  const subtotal = Number(order.partsTotal) + Number(order.laborTotal);

  return (
    <article className="print-page mx-auto max-w-5xl overflow-hidden rounded-2xl bg-white text-slate-950 shadow-xl print:rounded-none print:shadow-none">
      <div className="print-hidden flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 sm:px-10">
        <Link href={`/repair-orders/${order.id}`} className="text-sm font-semibold text-sky-700 hover:text-sky-800">← Back to repair order</Link>
        <PrintButton />
      </div>
      <div className="h-2 bg-sky-700" />
      <div className="p-6 sm:p-10 print:p-0">
        <header className="flex flex-col gap-8 border-b-2 border-slate-900 pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">Repair Order / Estimate</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{order.shop.name}</h1>
            <address className="mt-4 text-sm not-italic leading-6 text-slate-600">
              <span className="block">{order.shop.addressLine1 ?? "Address unavailable"}</span>
              <span className="block">{shopLocality || "City and state unavailable"}</span>
              <span className="block">{order.shop.phone ?? "Phone unavailable"}</span>
            </address>
          </div>
          <div className="min-w-60 rounded-xl bg-slate-950 p-5 text-white print:border print:border-slate-300 print:bg-white print:text-slate-950 sm:text-right">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300 print:text-slate-500">Repair order</p>
            <p className="mt-2 text-2xl font-black">#{order.repairOrderNumber ?? "Not assigned"}</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[1fr_auto]">
              <dt className="text-slate-400 print:text-slate-500">Date</dt><dd className="font-semibold">{formatDate(order.openedAt)}</dd>
              <dt className="text-slate-400 print:text-slate-500">Status</dt><dd className="font-semibold capitalize">{order.status}</dd>
            </dl>
          </div>
        </header>

        <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-bold uppercase tracking-wide text-amber-900 print:bg-white">Estimate only — not a finalized invoice</p>

        <section className="grid gap-4 py-7 sm:grid-cols-2">
          <InfoCard title="Customer">
            <p className="font-bold">{order.customer.displayName}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{order.customer.addressLine1 ?? "Address not recorded"}<br />{customerLocality || "City and state not recorded"}<br />{order.customer.phone ?? "Phone not recorded"}{order.customer.email ? <><br />{order.customer.email}</> : null}</p>
          </InfoCard>
          <InfoCard title="Vehicle">
            <p className="font-bold">{vehicle}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"><dt className="text-slate-500">License</dt><dd>{order.vehicle.licensePlate ?? "Not recorded"}</dd><dt className="text-slate-500">VIN</dt><dd>{order.vehicle.vin ?? "Not recorded"}</dd><dt className="text-slate-500">Mileage</dt><dd>{order.vehicle.odometer?.toLocaleString() ?? "Not recorded"}</dd></dl>
          </InfoCard>
        </section>

        {(order.customerComplaint || order.recommendation) && <section className="mb-7 break-inside-avoid rounded-xl border border-slate-200 p-5"><h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Customer Concerns &amp; Recommendations</h2><div className="mt-4 grid gap-5 sm:grid-cols-2">{order.customerComplaint && <div><h3 className="text-sm font-bold">Customer Complaint</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{order.customerComplaint}</p></div>}{order.recommendation && <div><h3 className="text-sm font-bold">Service Recommendation</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{order.recommendation}</p></div>}</div></section>}

        <EstimateTable title="Parts" empty="No parts recorded" headings={["Description", "Qty", "Unit price", "Amount"]}>
          {order.parts.map((part: PrintablePart) => <tr key={part.id}><td className="font-semibold text-slate-900">{part.description}</td><td className="text-right">{part.quantity.toString()}</td><td className="text-right">{formatMoney(part.unitPrice)}</td><td className="text-right font-semibold">{formatMoney(Number(part.quantity) * Number(part.unitPrice))}</td></tr>)}
        </EstimateTable>
        <EstimateTable title="Labor" empty="No labor recorded" headings={["Description", "Hours", "Rate", "Amount"]}>
          {order.labor.map((labor: PrintableLabor) => <tr key={labor.id}><td className="font-semibold text-slate-900">{labor.description}</td><td className="text-right">{labor.hours.toString()}</td><td className="text-right">{formatMoney(labor.hourlyRate)}</td><td className="text-right font-semibold">{formatMoney(Number(labor.hours) * Number(labor.hourlyRate))}</td></tr>)}
        </EstimateTable>

        <section className="mt-8 flex justify-end break-inside-avoid"><div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-5 print:bg-white"><h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Estimate summary</h2><dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-8 gap-y-2.5 text-sm"><dt className="text-slate-600">Parts total</dt><dd>{formatMoney(order.partsTotal)}</dd><dt className="text-slate-600">Labor total</dt><dd>{formatMoney(order.laborTotal)}</dd><dt className="border-t border-slate-300 pt-3 text-slate-600">Subtotal</dt><dd className="border-t border-slate-300 pt-3">{formatMoney(subtotal)}</dd><dt className="text-slate-600">Estimated tax</dt><dd>{formatMoney(order.taxTotal)}</dd><dt className="border-t-2 border-slate-900 pt-3 text-base font-black">Estimated total</dt><dd className="border-t-2 border-slate-900 pt-3 text-base font-black">{formatMoney(order.estimatedTotal)}</dd></dl></div></section>

        <footer className="mt-10 border-t border-slate-300 pt-5 text-center text-xs leading-5 text-slate-500"><p className="font-semibold text-slate-700">{order.shop.invoiceFooterMessage ?? `Thank you for choosing ${order.shop.name}.`}</p>{order.shop.warrantyText && <p className="mt-2 whitespace-pre-line">{order.shop.warrantyText}</p>}<p className="mt-2">This repair order is an estimate and is not a finalized invoice.</p></footer>
      </div>
    </article>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 print:bg-white"><h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{title}</h2>{children}</div>;
}

function EstimateTable({ title, empty, headings, children }: { title: string; empty: string; headings: string[]; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return <section className="invoice-section mt-7"><div className="mb-3 border-b-2 border-slate-900 pb-2"><h2 className="text-lg font-black">{title}</h2></div>{items.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">{empty}</p> : <table className="invoice-table w-full border-collapse text-sm"><thead><tr>{headings.map((heading, index) => <th key={heading} className={index === 0 ? "text-left" : "text-right"}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table>}</section>;
}
