"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  addInvoiceLaborWithState,
  addInvoicePartWithState,
  deleteInvoiceLabor,
  deleteInvoicePart,
  updateInvoiceDetailsWithState,
  updateInvoiceDiscountWithState,
  updateInvoiceLaborWithState,
  updateInvoicePartWithState,
  type InvoiceEditActionState,
  type InvoiceEditPreview,
} from "@/app/(app)/invoices/lifecycle-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { HistoricalDescriptionCombobox, ReadOnlyDescriptionPreview } from "@/components/historical-description-combobox";
import { PendingIcon, TrashIcon } from "@/components/line-item-layout";

type VendorOption = { id: string; name: string };
type PartLine = { id: string; description: string; quantity: string; unitPrice: string; vendorNameSnapshot: string | null };
type LaborLine = { id: string; description: string; hours: string; hourlyRate: string; shopSuppliesEligible: boolean };
type ComplimentaryLine = { id: string; description: string };
type CommonService = { id: string; name: string; description: string; defaultHours: string; defaultLaborRate: string; shopSuppliesEligible: boolean };

type InvoiceEditModel = {
  id: string;
  repairOrderNumber: number | null;
  customerComplaint: string | null;
  recommendation: string | null;
  discountAmount: string;
  totals: InvoiceEditPreview;
  vendors: VendorOption[];
  services: CommonService[];
  defaultLaborRate: string;
  parts: PartLine[];
  labor: LaborLine[];
  complimentary: ComplimentaryLine[];
};

const idle: InvoiceEditActionState = { status: "idle" };
const fieldClass = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-950 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
const descriptionClass = `${fieldClass} resize-none overflow-y-hidden whitespace-pre-wrap break-words leading-5`;
const money = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);

function TypeBadge({ type }: { type: "part" | "labor" | "complimentary" }) {
  const label = type === "part" ? "Part" : type === "labor" ? "Labor" : "Complimentary";
  const style = type === "part" ? "bg-blue-50 text-blue-800" : type === "labor" ? "bg-emerald-50 text-emerald-800" : "bg-violet-50 text-violet-800";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${style}`}>{label}</span>;
}

function DeleteIconButton({ action, invoiceId, lineId, kind }: { action: (formData: FormData) => Promise<void>; invoiceId: string; lineId: string; kind: "part" | "labor" }) {
  return <form action={action}>
    <input type="hidden" name="invoiceId" value={invoiceId} />
    <input type="hidden" name={kind === "part" ? "partId" : "laborId"} value={lineId} />
    <FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel={`Deleting ${kind}`} confirmMessage={`Delete this ${kind}?`} destructive ariaLabel={`Delete ${kind}`} title={`Delete ${kind}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"><TrashIcon /></FormSubmitButton>
  </form>;
}

function PartRow({ invoiceId, line, vendors }: { invoiceId: string; line: PartLine; vendors: VendorOption[] }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(line.description);
  const [quantity, setQuantity] = useState(line.quantity);
  const [unitPrice, setUnitPrice] = useState(line.unitPrice);
  const initialVendor = vendors.find((vendor) => vendor.name === line.vendorNameSnapshot)?.id ?? (line.vendorNameSnapshot ? "current-snapshot" : "");
  const [vendorId, setVendorId] = useState(initialVendor);
  const [state, action, pending] = useActionState(updateInvoicePartWithState, idle);
  useEffect(() => { if (state.status === "success") setEditing(false); }, [state.status]);

  if (!editing) return <div className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] lg:items-center lg:gap-3 sm:px-5">
    <div><TypeBadge type="part" /></div><ReadOnlyDescriptionPreview value={line.description} /><div className="text-slate-500">{line.vendorNameSnapshot ?? "—"}</div>
    <div className="text-right">{line.quantity}</div><div className="text-right">{money(line.unitPrice)}</div><div className="text-right font-semibold">{money(Number(line.quantity) * Number(line.unitPrice))}</div>
    <div className="flex justify-end gap-1"><button type="button" onClick={() => setEditing(true)} className="px-2 py-2 text-xs font-semibold text-brand-primary underline underline-offset-2">Edit</button><DeleteIconButton action={deleteInvoicePart} invoiceId={invoiceId} lineId={line.id} kind="part" /></div>
  </div>;

  return <form action={action} className="bg-blue-50/40 px-4 py-4 sm:px-5">
    <input type="hidden" name="invoiceId" value={invoiceId} /><input type="hidden" name="partId" value={line.id} />
    <div className="grid gap-3 lg:grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] lg:items-end">
      <div className="self-center"><TypeBadge type="part" /></div>
      <HistoricalDescriptionCombobox kind="part" rowKey={`invoice-part-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline />
      <label className="text-xs font-semibold text-slate-600">Vendor<select name="vendorId" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={`${fieldClass} mt-1`}><option value="">No vendor</option>{vendorId === "current-snapshot" ? <option value="current-snapshot">{line.vendorNameSnapshot}</option> : null}{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Qty<input required name="quantity" type="number" min="0.01" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Unit price<input required name="unitPrice" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <div className="self-center text-right font-semibold">{money(Number(quantity) * Number(unitPrice))}</div>
      <div className="flex flex-col gap-1"><button type="button" disabled={pending} onClick={() => setEditing(false)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 underline underline-offset-2">Cancel</button><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Saving…" : "Save"}</button></div>
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function LaborRow({ invoiceId, line }: { invoiceId: string; line: LaborLine }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(line.description);
  const [hours, setHours] = useState(line.hours);
  const [rate, setRate] = useState(line.hourlyRate);
  const [eligible, setEligible] = useState(line.shopSuppliesEligible);
  const [state, action, pending] = useActionState(updateInvoiceLaborWithState, idle);
  useEffect(() => { if (state.status === "success") setEditing(false); }, [state.status]);

  if (!editing) return <div className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] lg:items-center lg:gap-3 sm:px-5">
    <div><TypeBadge type="labor" /></div><ReadOnlyDescriptionPreview value={line.description} /><div className="text-slate-500">{line.shopSuppliesEligible ? "Shop supplies" : "—"}</div>
    <div className="text-right">{line.hours}</div><div className="text-right">{money(line.hourlyRate)}</div><div className="text-right font-semibold">{money(Number(line.hours) * Number(line.hourlyRate))}</div>
    <div className="flex justify-end gap-1"><button type="button" onClick={() => setEditing(true)} className="px-2 py-2 text-xs font-semibold text-brand-primary underline underline-offset-2">Edit</button><DeleteIconButton action={deleteInvoiceLabor} invoiceId={invoiceId} lineId={line.id} kind="labor" /></div>
  </div>;

  return <form action={action} className="bg-emerald-50/40 px-4 py-4 sm:px-5">
    <input type="hidden" name="invoiceId" value={invoiceId} /><input type="hidden" name="laborId" value={line.id} /><input type="hidden" name="shopSuppliesEligible" value={String(eligible)} />
    <div className="grid gap-3 lg:grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] lg:items-end">
      <div className="self-center"><TypeBadge type="labor" /></div>
      <HistoricalDescriptionCombobox kind="labor" rowKey={`invoice-labor-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline />
      <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-primary" />Shop supplies</label>
      <label className="text-xs font-semibold text-slate-600">Hours<input required name="hours" type="number" min="0.01" step="0.01" value={hours} onChange={(e) => setHours(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Rate<input required name="hourlyRate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <div className="self-center text-right font-semibold">{money(Number(hours) * Number(rate))}</div>
      <div className="flex flex-col gap-1"><button type="button" disabled={pending} onClick={() => setEditing(false)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 underline underline-offset-2">Cancel</button><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Saving…" : "Save"}</button></div>
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function PresetPicker({ services, selectedId, onSelect, onClear }: { services: CommonService[]; selectedId: string | null; onSelect: (service: CommonService) => void; onClear: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false); const [query, setQuery] = useState("");
  const quick = services.slice(0, 3); const remaining = Math.max(0, services.length - quick.length);
  const selected = services.find((service) => service.id === selectedId) ?? null;
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? services.filter((service) => `${service.name} ${service.description}`.toLowerCase().includes(q)) : services; }, [query, services]);
  if (!services.length) return null;
  return <div className="mb-3">
    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-600">Common services</span>{quick.map((service) => <button key={service.id} type="button" onClick={() => onSelect(service)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedId === service.id ? "border-brand-primary bg-brand-primary text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-primary/50 hover:text-brand-primary"}`}>{service.name}</button>)}{remaining > 0 ? <button type="button" onClick={() => setMoreOpen((open) => !open)} className="rounded-full border border-dashed border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-primary hover:text-brand-primary">More services ({remaining})</button> : null}{selected ? <span className="ml-auto text-xs text-slate-500">From preset: <strong className="text-slate-700">{selected.name}</strong> <button type="button" onClick={onClear} className="ml-1 font-semibold text-brand-primary underline underline-offset-2">Clear preset</button></span> : null}</div>
    {moreOpen ? <div className="mt-2 max-w-2xl rounded-xl border border-slate-300 bg-white p-3 shadow-sm"><div className="flex gap-2"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search common services…" className={`${fieldClass} flex-1`} /><button type="button" onClick={() => { setMoreOpen(false); setQuery(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600">Close</button></div><div className="mt-2 max-h-52 overflow-y-auto">{filtered.map((service) => <button key={service.id} type="button" onClick={() => { onSelect(service); setMoreOpen(false); setQuery(""); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"><span className="block text-sm font-semibold text-slate-800">{service.name}</span><span className="mt-0.5 block text-xs text-slate-500">{service.defaultHours} hrs · {money(service.defaultLaborRate)}{service.shopSuppliesEligible ? " · Shop supplies" : ""}</span></button>)}</div></div> : null}
  </div>;
}

function AddLineItem({ invoice }: { invoice: InvoiceEditModel }) {
  const [type, setType] = useState<"part" | "labor">("part");
  const [key, setKey] = useState(0);
  return <div className="border-t border-slate-300 bg-slate-50/70 px-4 py-4 sm:px-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900">Add line item</h3><p className="mt-0.5 text-xs text-slate-500">Use the same compact workflow as Repair Orders.</p></div><select value={type} onChange={(e) => { setType(e.target.value as "part" | "labor"); setKey((v) => v + 1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><option value="part">Part</option><option value="labor">Labor</option></select></div>{type === "part" ? <DraftPart key={`p-${key}`} invoiceId={invoice.id} vendors={invoice.vendors} onSaved={() => setKey((v) => v + 1)} /> : <DraftLabor key={`l-${key}`} invoiceId={invoice.id} services={invoice.services} defaultRate={invoice.defaultLaborRate} onSaved={() => setKey((v) => v + 1)} />}</div>;
}

function DraftPart({ invoiceId, vendors, onSaved }: { invoiceId: string; vendors: VendorOption[]; onSaved: () => void }) {
  const [description, setDescription] = useState(""); const [quantity, setQuantity] = useState("1"); const [unitPrice, setUnitPrice] = useState(""); const [state, action, pending] = useActionState(addInvoicePartWithState, idle);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  return <form action={action}><input type="hidden" name="invoiceId" value={invoiceId} /><div className="grid gap-3 lg:grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] lg:items-end"><div className="self-center"><TypeBadge type="part" /></div><HistoricalDescriptionCombobox kind="part" rowKey="invoice-part-draft" value={description} onChange={setDescription} inputClass={descriptionClass} multiline /><label className="text-xs font-semibold text-slate-600">Vendor<select name="vendorId" defaultValue="" className={`${fieldClass} mt-1`}><option value="">No vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Qty<input required name="quantity" type="number" min="0.01" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600">Unit price<input required name="unitPrice" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={`${fieldClass} mt-1`} /></label><div className="self-center text-right font-semibold">{money(Number(quantity) * Number(unitPrice))}</div><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Adding…" : "+ Add"}</button></div>{state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}</form>;
}

function DraftLabor({ invoiceId, services, defaultRate, onSaved }: { invoiceId: string; services: CommonService[]; defaultRate: string; onSaved: () => void }) {
  const [description, setDescription] = useState(""); const [hours, setHours] = useState(""); const [rate, setRate] = useState(defaultRate); const [eligible, setEligible] = useState(true); const [presetId, setPresetId] = useState<string | null>(null); const [state, action, pending] = useActionState(addInvoiceLaborWithState, idle);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  const choose = (service: CommonService) => { setPresetId(service.id); setDescription(service.description); setHours(service.defaultHours); setRate(service.defaultLaborRate); setEligible(service.shopSuppliesEligible); };
  return <form action={action}><input type="hidden" name="invoiceId" value={invoiceId} /><input type="hidden" name="shopSuppliesEligible" value={String(eligible)} /><PresetPicker services={services} selectedId={presetId} onSelect={choose} onClear={() => setPresetId(null)} /><div className="grid gap-3 lg:grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] lg:items-end"><div className="self-center"><TypeBadge type="labor" /></div><HistoricalDescriptionCombobox kind="labor" rowKey="invoice-labor-draft" value={description} onChange={setDescription} inputClass={descriptionClass} multiline /><label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-primary" />Shop supplies</label><label className="text-xs font-semibold text-slate-600">Hours<input required name="hours" type="number" min="0.01" step="0.01" value={hours} onChange={(e) => setHours(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600">Rate<input required name="hourlyRate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={`${fieldClass} mt-1`} /></label><div className="self-center text-right font-semibold">{money(Number(hours) * Number(rate))}</div><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Adding…" : "+ Add"}</button></div>{state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}</form>;
}

function FinancialSummary({ invoice }: { invoice: InvoiceEditModel }) {
  const [discount, setDiscount] = useState(invoice.discountAmount); const [state, action, pending] = useActionState(updateInvoiceDiscountWithState, idle);
  const row = (label: string, value: string, strong = false) => <><dt className={strong ? "border-t border-slate-200 pt-3 font-semibold text-slate-950" : "text-slate-500"}>{label}</dt><dd className={`text-right tabular-nums ${strong ? "border-t border-slate-200 pt-3 font-semibold text-slate-950" : "text-slate-800"}`}>{money(value)}</dd></>;
  return <aside className="self-start lg:sticky lg:top-6"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Balance due</p><p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{money(invoice.totals.balance)}</p></div><dl className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 text-sm">{row("Parts", invoice.totals.parts)}{row("Labor", invoice.totals.labor)}{row("Shop supplies", invoice.totals.shopSupplies)}{row("Discount", `-${invoice.totals.discount}`)}{row("Tax", invoice.totals.tax)}{row("Total", invoice.totals.total, true)}{row("Paid", invoice.totals.paid)}{row("Balance", invoice.totals.balance, true)}</dl><form action={action} className="mt-5 border-t border-slate-200 pt-4"><input type="hidden" name="invoiceId" value={invoice.id} /><label className="text-xs font-bold uppercase tracking-wider text-slate-500">Discount<input required name="discountAmount" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${fieldClass} mt-1.5`} /></label><FormSubmitButton disabled={pending || Number(discount) === Number(invoice.discountAmount)} pendingLabel="Saving…" className="mt-2 w-full rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save Discount</FormSubmitButton>{state.status === "success" ? <p className="mt-2 text-xs font-medium text-emerald-700">Discount saved.</p> : state.status === "error" ? <p className="mt-2 text-xs font-medium text-red-700">{state.message}</p> : null}</form></section></aside>;
}

export function InvoiceEditWorkspaceV2({ invoice }: { invoice: InvoiceEditModel }) {
  const [complaint, setComplaint] = useState(invoice.customerComplaint ?? ""); const [recommendation, setRecommendation] = useState(invoice.recommendation ?? ""); const [detailsState, detailsAction, detailsPending] = useActionState(updateInvoiceDetailsWithState, idle);
  return <div className="space-y-5"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><Link href={`/invoices/${invoice.id}`} className="text-sm font-semibold text-brand-primary">← Back to invoice</Link><h1 className="mt-3 text-3xl font-bold text-slate-950">Edit Invoice — RO #{invoice.repairOrderNumber}</h1><p className="mt-1 text-sm text-slate-600">Edit the open invoice. Line changes recalculate the invoice and accounts receivable while preserving recorded payments.</p></div><Link href={`/invoices/${invoice.id}`} className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link></header>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="min-w-0 space-y-5">
        <form action={detailsAction} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><input type="hidden" name="invoiceId" value={invoice.id} /><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-bold text-slate-950">Customer Concerns &amp; Recommendations</h2><button disabled={detailsPending} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{detailsPending ? "Saving…" : "Save"}</button></div><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs font-bold uppercase tracking-wider text-slate-500">Customer Complaint<textarea name="customerComplaint" rows={3} value={complaint} onChange={(e) => setComplaint(e.target.value)} className={`${fieldClass} mt-1.5 resize-y`} /></label><label className="text-xs font-bold uppercase tracking-wider text-slate-500">Service Recommendation<textarea name="recommendation" rows={3} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} className={`${fieldClass} mt-1.5 resize-y`} /></label></div>{detailsState.status === "success" ? <p className="mt-2 text-sm font-medium text-emerald-700">Invoice details saved.</p> : detailsState.status === "error" ? <p className="mt-2 text-sm font-medium text-red-700">{detailsState.message}</p> : null}</form>
        <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5"><div><h2 className="text-base font-bold text-slate-950">Line items</h2><p className="mt-1 text-xs text-slate-500">Parts and Labor use the same compact editing pattern as Repair Orders.</p></div><p className="text-sm font-semibold text-slate-700">Parts {money(invoice.totals.parts)} <span className="mx-1 text-slate-300">·</span> Labor {money(invoice.totals.labor)}</p></div><div className="hidden grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 lg:grid sm:px-5"><span>Type</span><span>Description</span><span>Vendor / service</span><span className="text-right">Qty / hrs</span><span className="text-right">Price / rate</span><span className="text-right">Amount</span><span /></div><div className="divide-y divide-slate-200">{invoice.parts.map((line) => <PartRow key={line.id} invoiceId={invoice.id} line={line} vendors={invoice.vendors} />)}{invoice.labor.map((line) => <LaborRow key={line.id} invoiceId={invoice.id} line={line} />)}{invoice.complimentary.map((line) => <div key={line.id} className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[6.25rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_6.5rem_7rem_5.5rem] lg:items-center lg:gap-3 sm:px-5"><TypeBadge type="complimentary" /><ReadOnlyDescriptionPreview value={line.description} /><div className="text-slate-500">—</div><div className="text-right">—</div><div className="text-right">—</div><div className="text-right font-semibold">$0.00</div><div /></div>)}{!invoice.parts.length && !invoice.labor.length && !invoice.complimentary.length ? <p className="px-5 py-5 text-sm text-slate-500">No line items yet.</p> : null}</div><AddLineItem invoice={invoice} /></section>
      </main><FinancialSummary invoice={invoice} />
    </div>
  </div>;
}
