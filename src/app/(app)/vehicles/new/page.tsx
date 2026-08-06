import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";
import { createVehicle } from "../../customer-vehicle-create-actions";

export default async function NewVehiclePage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { membership } = await getCurrentMembership();
  const { customerId } = await searchParams;
  const customers = membership ? await prisma.customer.findMany({ where: { shopId: membership.shopId, archivedAt: null }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }) : [];
  const fixed = customerId ? customers.find((customer) => customer.id === customerId) : null;
  const input = "mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal";
  return <div className="mx-auto max-w-3xl"><Link href={fixed ? `/customers/${fixed.id}` : "/vehicles"} className="text-sm font-semibold text-brand-primary">← Back</Link><header className="mt-5"><p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Vehicle</p><h1 className="mt-2 text-3xl font-bold text-slate-950">New vehicle</h1></header><form action={createVehicle} className="mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2">
    {fixed ? <><input type="hidden" name="customerId" value={fixed.id} /><p className="sm:col-span-2 text-sm"><span className="font-semibold">Customer:</span> {fixed.displayName}</p></> : <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Customer<select name="customerId" required className={input}><option value="">Select an active customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label>}
    <label className="text-sm font-semibold text-slate-700">Year<input name="year" type="number" required min="1886" max={new Date().getFullYear() + 1} className={input} /></label><label className="text-sm font-semibold text-slate-700">Make<input name="make" required maxLength={100} className={input} /></label><label className="text-sm font-semibold text-slate-700">Model<input name="model" required maxLength={100} className={input} /></label><label className="text-sm font-semibold text-slate-700">License plate<input name="licensePlate" maxLength={30} className={input} /></label><label className="text-sm font-semibold text-slate-700 sm:col-span-2">VIN<input name="vin" maxLength={50} className={input} /></label><label className="text-sm font-semibold text-slate-700">Odometer / mileage<input name="odometer" type="number" min="0" max="10000000" className={input} /></label>
    <div className="flex items-end gap-3 sm:col-span-2"><button className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Create vehicle</button><Link href={fixed ? `/customers/${fixed.id}` : "/vehicles"} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link></div>
  </form></div>;
}
