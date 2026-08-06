import Link from "next/link";
import { CustomerPhoneInput } from "@/components/customer-phone-input";
import { createCustomer } from "../../customer-vehicle-create-actions";

export default function NewCustomerPage() {
  const input = "mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal";
  return <div className="mx-auto max-w-3xl"><Link href="/customers" className="text-sm font-semibold text-brand-primary">← Customers</Link><header className="mt-5"><p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Customer</p><h1 className="mt-2 text-3xl font-bold text-slate-950">New customer</h1></header><form action={createCustomer} className="mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2">
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Display name<input name="displayName" required maxLength={200} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700">Primary phone<CustomerPhoneInput maxLength={40} className={input} /></label><label className="text-sm font-semibold text-slate-700">Additional phone (optional)<CustomerPhoneInput name="phone2" maxLength={40} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Email<input name="email" type="email" maxLength={254} className={input} /></label><label className="text-sm font-semibold text-slate-700 sm:col-span-2">Address<input name="addressLine1" maxLength={200} className={input} /></label><label className="text-sm font-semibold text-slate-700">City<input name="city" maxLength={100} className={input} /></label><label className="text-sm font-semibold text-slate-700">State<input name="state" maxLength={30} className={input} /></label><label className="text-sm font-semibold text-slate-700">Postal code<input name="postalCode" maxLength={20} className={input} /></label>
    <div className="flex items-end gap-3"><button className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Create customer</button><Link href="/customers" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link></div>
  </form></div>;
}
