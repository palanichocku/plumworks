"use client";

import Link from "next/link";
import { useState } from "react";
import type { CustomerDuplicate, DuplicateGroup, VehicleDuplicate } from "@/lib/data/duplicates";

type Tab = "customers" | "vehicles" | "quality";
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("en-US") : "Not recorded";
const money = (value: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const confidenceClass = { High: "bg-emerald-100 text-emerald-800", Medium: "bg-amber-100 text-amber-800", Low: "bg-slate-100 text-slate-700", "Data quality only": "bg-violet-100 text-violet-800" } as const;

export function DuplicateComparison({ customerGroups, vehicleGroups }: { customerGroups: Array<DuplicateGroup<CustomerDuplicate>>; vehicleGroups: Array<DuplicateGroup<VehicleDuplicate>> }) {
  const [tab, setTab] = useState<Tab>("customers");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const customerDuplicates = customerGroups.filter((group) => group.confidence !== "Data quality only");
  const vehicleDuplicates = vehicleGroups.filter((group) => group.confidence !== "Data quality only");
  const qualityGroups = [...customerGroups.filter((group) => group.confidence === "Data quality only"), ...vehicleGroups.filter((group) => group.confidence === "Data quality only")];
  const source = tab === "customers" ? customerDuplicates : tab === "vehicles" ? vehicleDuplicates : qualityGroups;
  const visible = source;
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <>
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex rounded-lg bg-slate-100 p-1" aria-label="Duplicate type">
        <button type="button" onClick={() => setTab("customers")} className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "customers" ? "bg-white text-brand-primary shadow-sm" : "text-slate-600"}`}>Customer Duplicates ({customerDuplicates.length})</button>
        <button type="button" onClick={() => setTab("vehicles")} className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "vehicles" ? "bg-white text-brand-primary shadow-sm" : "text-slate-600"}`}>Vehicle Duplicates ({vehicleDuplicates.length})</button>
        <button type="button" onClick={() => setTab("quality")} className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "quality" ? "bg-white text-brand-primary shadow-sm" : "text-slate-600"}`}>Data Quality Flags ({qualityGroups.length})</button>
      </div>
      <div className="ml-auto flex gap-2"><button type="button" onClick={() => setExpanded((current) => new Set([...current, ...visible.map((group) => group.id)]))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Expand all</button><button type="button" onClick={() => setExpanded(new Set())} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Collapse all</button></div>
    </div>
    {visible.length === 0 ? <section className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="text-lg font-semibold">No duplicate groups match these filters</h2><p className="mt-2 text-sm text-slate-600">Try another record type or confidence level.</p></section> : <div className="mt-5 space-y-4">{visible.map((group) => {
      const open = expanded.has(group.id);
      return <section key={group.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => toggle(group.id)} aria-expanded={open} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-slate-50"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-lg font-semibold text-slate-700">{open ? "−" : "+"}</span><span className="min-w-0 flex-1"><span className="block font-semibold text-slate-950">{group.reason}</span><span className="mt-1 block text-xs text-slate-500">{group.totalCount} possible matching records</span></span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${confidenceClass[group.confidence]}`}>{group.confidence} confidence</span></button>
        {open && <div className="overflow-x-auto border-t border-slate-200">{group.entityType === "customer" ? <CustomerTable group={group as DuplicateGroup<CustomerDuplicate>} /> : <VehicleTable group={group as DuplicateGroup<VehicleDuplicate>} />}</div>}
      </section>;
    })}</div>}
  </>;
}

function CustomerTable({ group }: { group: DuplicateGroup<CustomerDuplicate> }) {
  return <table className="min-w-[1500px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{["Name", "Phone", "Email", "Address", "Vehicles", "Invoices", "Repair orders", "Open AR", "Last activity", "Created", "Updated", ""].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{group.records.map((record) => <tr key={record.id} className="align-top"><td className="px-4 py-3 font-medium text-slate-950">{record.displayName}</td><td className="px-4 py-3">{record.phone ?? "Not recorded"}</td><td className="px-4 py-3">{record.email ?? "Not recorded"}</td><td className="px-4 py-3">{[record.addressLine1, [record.city, record.state, record.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Not recorded"}</td><td className="px-4 py-3">{record.vehicleCount}</td><td className="px-4 py-3">{record.invoiceCount}</td><td className="px-4 py-3">{record.repairOrderCount}</td><td className="px-4 py-3">{money(record.openArBalance)}</td><td className="px-4 py-3">{date(record.lastActivityAt)}</td><td className="px-4 py-3">{date(record.createdAt)}</td><td className="px-4 py-3">{date(record.updatedAt)}</td><td className="px-4 py-3"><Link href={`/customers/${record.id}`} className="font-semibold text-brand-primary">View</Link></td></tr>)}</tbody></table>;
}

function VehicleTable({ group }: { group: DuplicateGroup<VehicleDuplicate> }) {
  return <table className="min-w-[1400px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{["Year", "Make", "Model", "License plate", "VIN", "Customer", "Invoices", "Repair orders", "Last activity", "Created", "Updated", ""].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{group.records.map((record) => <tr key={record.id} className="align-top"><td className="px-4 py-3">{record.year ?? "—"}</td><td className="px-4 py-3">{record.make ?? "—"}</td><td className="px-4 py-3">{record.model ?? "—"}</td><td className="px-4 py-3">{record.licensePlate ?? "Not recorded"}</td><td className="px-4 py-3">{record.vin ?? "Not recorded"}</td><td className="px-4 py-3 font-medium text-slate-950">{record.customerName}</td><td className="px-4 py-3">{record.invoiceCount}</td><td className="px-4 py-3">{record.repairOrderCount}</td><td className="px-4 py-3">{date(record.lastActivityAt)}</td><td className="px-4 py-3">{date(record.createdAt)}</td><td className="px-4 py-3">{date(record.updatedAt)}</td><td className="px-4 py-3"><Link href={`/vehicles/${record.id}`} className="font-semibold text-brand-primary">View</Link></td></tr>)}</tbody></table>;
}
