import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerForEdit } from "@/lib/data/customers";
import { updateCustomer } from "../../edit-actions";
import { CustomerEditForm } from "@/components/customer-edit-form";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getCustomerForEdit(id);
  if (!customer) notFound();

  return <div className="mx-auto max-w-3xl">
    <Link href={`/customers/${customer.id}`} className="text-sm font-semibold text-brand-primary">← Customer details</Link>
    <header className="mt-5"><p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Customer</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Edit customer</h1></header>
    <CustomerEditForm customer={customer} action={updateCustomer} cancelHref={`/customers/${customer.id}`} />
  </div>;
}
