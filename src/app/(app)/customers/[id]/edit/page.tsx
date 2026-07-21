import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerForEdit } from "@/lib/data/customers";
import { updateCustomer } from "../../edit-actions";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getCustomerForEdit(id);
  if (!customer) notFound();

  return <div className="mx-auto max-w-3xl">
    <Link href={`/customers/${customer.id}`} className="text-sm font-semibold text-brand-primary">← Customer details</Link>
    <header className="mt-5"><p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Customer</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Edit customer</h1></header>
    <form action={updateCustomer} className="mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2">
      <input type="hidden" name="customerId" value={customer.id} />
      <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Display name<input name="displayName" required maxLength={200} defaultValue={customer.displayName} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">Phone<input name="phone" type="tel" maxLength={40} defaultValue={customer.phone ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">Email<input name="email" type="email" maxLength={254} defaultValue={customer.email ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Address<input name="addressLine1" maxLength={200} defaultValue={customer.addressLine1 ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">City<input name="city" maxLength={100} defaultValue={customer.city ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">State<input name="state" maxLength={30} defaultValue={customer.state ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">Postal code<input name="postalCode" maxLength={20} defaultValue={customer.postalCode ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <div className="flex items-end gap-3"><button type="submit" className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Save customer</button><Link href={`/customers/${customer.id}`} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link></div>
    </form>
  </div>;
}
