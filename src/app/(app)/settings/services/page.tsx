import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createCannedService, deleteCannedService, updateCannedService } from "./actions";

export const dynamic = "force-dynamic";

export default async function CannedServicesPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "manage_canned_services")) return <PermissionDenied />;
  const services = await prisma.cannedService.findMany({ where: { shopId: membership.shopId }, orderBy: [{ active: "desc" }, { name: "asc" }] });

  return <>
    <Link href="/settings" className="text-sm font-semibold text-sky-700 hover:text-sky-800">← Settings</Link>
    <div className="mt-5"><PageHeading eyebrow="Shop templates" title="Common Services" description="Reusable labor templates copied into draft repair orders." /></div>
    <section className="space-y-4">
      {services.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No canned services have been configured.</p> : services.map((service) => <form key={service.id} action={updateCannedService} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_2fr_7rem_9rem_auto] lg:items-end">
        <input type="hidden" name="serviceId" value={service.id} />
        <label className="text-sm font-semibold text-slate-700">Service name<input name="name" required maxLength={100} defaultValue={service.name} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} defaultValue={service.description} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Hours<input name="defaultHours" type="number" required min="0.01" max="1000" step="0.01" defaultValue={service.defaultHours.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Labor rate<input name="defaultLaborRate" type="number" required min="0" max="1000000" step="0.01" defaultValue={service.defaultLaborRate.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-sm font-medium"><input name="active" type="checkbox" defaultChecked={service.active} /> Active</label><button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white" type="submit">Save</button><button className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700" type="submit" formAction={deleteCannedService}>Delete</button></div>
      </form>)}
    </section>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Add service</h2><form action={createCannedService} className="mt-5 grid gap-3 lg:grid-cols-[1fr_2fr_7rem_9rem_auto] lg:items-end"><label className="text-sm font-semibold text-slate-700">Service name<input name="name" required maxLength={100} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Hours<input name="defaultHours" type="number" required min="0.01" max="1000" step="0.01" defaultValue="1" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Labor rate<input name="defaultLaborRate" type="number" required min="0" max="1000000" step="0.01" defaultValue="60" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm font-medium"><input name="active" type="checkbox" defaultChecked /> Active</label><button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Add</button></div></form></section>
  </>;
}
