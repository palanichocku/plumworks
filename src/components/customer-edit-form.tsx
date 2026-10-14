import Link from "next/link";
import { CustomerPhoneInput } from "@/components/customer-phone-input";

type CustomerEditValues = {
  id: string;
  displayName: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

type CustomerEditAction = (formData: FormData) => void | Promise<void>;

export function CustomerEditForm({
  customer,
  action,
  returnTo,
  cancelHref,
  embedded = false,
}: {
  customer: CustomerEditValues;
  action: CustomerEditAction;
  returnTo?: string;
  cancelHref?: string;
  embedded?: boolean;
}) {
  return <form action={action} className={embedded ? "grid gap-5 sm:grid-cols-2" : "mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2"}>
    <input type="hidden" name="customerId" value={customer.id} />
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Display name<input name="displayName" required maxLength={200} defaultValue={customer.displayName} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">Primary phone<CustomerPhoneInput maxLength={40} defaultValue={customer.phone} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">Additional phone (optional)<CustomerPhoneInput name="phone2" maxLength={40} defaultValue={customer.phone2} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Email<input name="email" type="email" maxLength={254} defaultValue={customer.email ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Address<input name="addressLine1" maxLength={200} defaultValue={customer.addressLine1 ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">City<input name="city" maxLength={100} defaultValue={customer.city ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">State<input name="state" maxLength={30} defaultValue={customer.state ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">Postal code<input name="postalCode" maxLength={20} defaultValue={customer.postalCode ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <div className="flex items-end gap-3 sm:col-span-2">
      <button type="submit" className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Save customer</button>
      {cancelHref ? <Link href={cancelHref} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link> : null}
    </div>
  </form>;
}
