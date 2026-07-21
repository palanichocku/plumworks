import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { searchCurrentShop } from "@/lib/data/search";
import { formatDate, formatMoney } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q?.trim() ?? "";
  const results = await searchCurrentShop(query);
  const total = results.customers.length + results.vehicles.length + results.repairOrders.length + results.invoices.length;

  return <>
    <PageHeading eyebrow="Shop search" title="Search" description="Find customers, vehicles, repair orders, and invoices in your current shop." />
    <form action="/search" className="mb-7 flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><label htmlFor="global-search-page" className="sr-only">Search shop</label><input id="global-search-page" name="q" type="search" defaultValue={query} autoFocus placeholder="Name, phone, vehicle, VIN, license, or RO number" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><button type="submit" className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Search</button></form>
    {!query ? <Empty title="Search your shop" text="Enter a customer, vehicle, VIN, license plate, or repair-order number." /> : total === 0 ? <Empty title="No results found" text="Try a different name, number, or vehicle detail." /> : <div className="grid gap-6 lg:grid-cols-2">
      <ResultGroup title="Customers" count={results.customers.length}>{results.customers.map((customer) => <li key={customer.id}><Link href={`/customers/${customer.id}`} className="block px-5 py-4 hover:bg-slate-50"><p className="font-semibold text-slate-950">{customer.displayName}</p><p className="mt-1 text-sm text-slate-600">{customer.phone ?? "Phone not recorded"}</p></Link></li>)}</ResultGroup>
      <ResultGroup title="Vehicles" count={results.vehicles.length}>{results.vehicles.map((vehicle) => <li key={vehicle.id}><Link href={`/vehicles/${vehicle.id}`} className="block px-5 py-4 hover:bg-slate-50"><p className="font-semibold text-slate-950">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable"}</p><p className="mt-1 text-sm text-slate-600">{vehicle.licensePlate ?? "License not recorded"}</p></Link></li>)}</ResultGroup>
      <ResultGroup title="Repair Orders" count={results.repairOrders.length}>{results.repairOrders.map((order) => <li key={order.id}><Link href={order.legacySourceTable ? `/open-orders/${order.id}` : `/repair-orders/${order.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50"><span><span className="block font-semibold text-slate-950">RO #{order.repairOrderNumber ?? order.legacyRoNo ?? "Not recorded"}</span><span className="mt-1 block text-sm text-slate-600">{formatDate(order.openedAt)}</span></span><span className="text-xs font-semibold uppercase text-slate-500">{order.status}</span></Link></li>)}</ResultGroup>
      <ResultGroup title="Invoices" count={results.invoices.length}>{results.invoices.map((invoice) => <li key={invoice.id}><Link href={`/invoices/${invoice.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50"><span><span className="block font-semibold text-slate-950">RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Not recorded"}</span><span className="mt-1 block text-sm text-slate-600">{formatDate(invoice.invoiceDate)}</span></span><span className="font-semibold text-slate-900">{formatMoney(invoice.total)}</span></Link></li>)}</ResultGroup>
    </div>}
  </>;
}

function ResultGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">{title}</h2><span className="text-sm text-slate-500">{count}</span></header>{count ? <ul className="divide-y divide-slate-200">{children}</ul> : <p className="px-5 py-6 text-sm text-slate-600">No matches in this group.</p>}</section>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="text-xl font-semibold text-slate-950">{title}</h2><p className="mt-2 text-sm text-slate-600">{text}</p></section>;
}
