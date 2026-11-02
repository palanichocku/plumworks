import Link from "next/link";
import { CustomerPhoneInput } from "@/components/customer-phone-input";
import { customerNameParts } from "@/lib/customer-name";

type CustomerEditValues = {
  id: string;
  displayName: string;
  firstName: string | null;
  legacyCustno?: string | null;
  legacySourceTable?: string | null;
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
  formId,
}: {
  customer: CustomerEditValues;
  action: CustomerEditAction;
  returnTo?: string;
  cancelHref?: string;
  embedded?: boolean;
  formId?: string;
}) {
  const { firstName, lastName } = customerNameParts(customer);
  const input = "mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal";

  return <form id={formId} action={action} className={embedded ? "grid gap-5 sm:grid-cols-2" : "mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2"}>
    <input type="hidden" name="customerId" value={customer.id} />
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <label className="text-sm font-semibold text-slate-700">First name<input name="firstName" required maxLength={100} autoComplete="given-name" defaultValue={firstName} placeholder={firstName ? undefined : "Required when saving"} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700">Last name<input name="lastName" required maxLength={100} autoComplete="family-name" defaultValue={lastName} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700">Primary phone<CustomerPhoneInput maxLength={40} defaultValue={customer.phone} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700">Additional phone (optional)<CustomerPhoneInput name="phone2" maxLength={40} defaultValue={customer.phone2} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Email<input name="email" type="email" maxLength={254} defaultValue={customer.email ?? ""} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Address<input name="addressLine1" maxLength={200} defaultValue={customer.addressLine1 ?? ""} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700">City<input name="city" maxLength={100} defaultValue={customer.city ?? ""} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700">State<input name="state" maxLength={30} defaultValue={customer.state ?? ""} className={input} /></label>
    <label className="text-sm font-semibold text-slate-700">Postal code<input name="postalCode" maxLength={20} defaultValue={customer.postalCode ?? ""} className={input} /></label>
    {!embedded ? <div className="flex items-end gap-3 sm:col-span-2">
      <button type="submit" className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Save customer</button>
      {cancelHref ? <Link href={cancelHref} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link> : null}
    </div> : null}
  </form>;
}
