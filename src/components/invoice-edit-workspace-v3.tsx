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
import {
  addInvoiceComplimentaryWithState,
  deleteInvoiceComplimentary,
  updateInvoiceComplimentaryWithState,
  type ComplimentaryEditActionState,
} from "@/app/(app)/invoices/complimentary-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { HistoricalDescriptionCombobox, ReadOnlyDescriptionPreview } from "@/components/historical-description-combobox";
import { PendingIcon, TrashIcon } from "@/components/line-item-layout";
import { VendorCombobox, type VendorOption } from "@/components/vendor-combobox";

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

type ItemType = "part" | "labor" | "complimentary";

const idle: InvoiceEditActionState = { status: "idle" };
const complimentaryIdle: ComplimentaryEditActionState = { status: "idle" };
const fieldClass = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-950 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
const descriptionClass = `${fieldClass} resize-none overflow-y-hidden whitespace-pre-wrap break-words leading-5`;
const money = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);

function TypeBadge({ type }: { type: ItemType }) {
  const label = type === "part" ? "Part" : type === "labor" ? "Labor" : "Complimentary";
  const style = type === "part" ? "bg-blue-50 text-blue-700" : type === "labor" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${style}`}>{label}</span>;
}

function RowShell({ children, editing = false, tone = "" }: { children: React.ReactNode; editing?: boolean; tone?: string }) {
  return <div className={`${editing ? tone : "bg-white"} border-t border-slate-200 px-4 py-3 sm:px-5`}>{children}</div>;
}

function DeleteButton({ action, invoiceId, lineId, kind }: { action: (formData: FormData) => Promise<void>; invoiceId: string; lineId: string; kind: "part" | "labor" | "complimentary" }) {
  return <form action={action}>
    <input type="hidden" name="invoiceId" value={invoiceId} />
    <input type="hidden" name={kind === "part" ? "partId" : "laborId"} value={lineId} />
    <FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel={`Deleting ${kind}`} confirmMessage={`Delete this ${kind} item?`} destructive ariaLabel={`Delete ${kind}`} title={`Delete ${kind}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"><TrashIcon /></FormSubmitButton>
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

  if (!editing) return <RowShell><div className="grid gap-2 text-sm lg:grid-cols-[7.2rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_7rem_7rem_5.5rem] lg:items-center lg:gap-3"><div><TypeBadge type="part" /></div><ReadOnlyDescriptionPreview value={line.description} /><div className="text-slate-500">{line.vendorNameSnapshot ?? "—"}</div><div className="text-right">{line.quantity}</div><div className="text-right">{money(line.unitPrice)}</div><div className="text-right font-semibold text-slate-950">{money(Number(line.quantity) * Number(line.unitPrice))}</div><div className="flex justify-end gap-1"><button type="button" onClick={() => setEditing(true)} className="px-2 py-2 text-xs font-semibold text-brand-primary underline underline-offset-2">Edit</button><DeleteButton action={deleteInvoicePart} invoiceId={invoiceId} lineId={line.id} kind="part" /></div></div></RowShell>;

  return <RowShell editing tone="bg-blue-50/40"><form action={action}><input type="hidden" name="invoiceId" value={invoiceId} /><input type="hidden" name="partId" value={line.id} /><div className="grid gap-3 lg:grid-cols-[7.2rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_7rem_7rem_5.5rem] lg:items-end"><div className="self-center"><TypeBadge type="part" /></div><HistoricalDescriptionCombobox kind="part" rowKey={`invoice-edit-part-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline /><label className="text-xs font-semibold text-slate-600">Vendor<select name="vendorId" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={`${fieldClass} mt-1`}><option value="">No vendor</option>{vendorId === "current-snapshot" ? <option value="current-snapshot">{line.vendorNameSnapshot}</option> : null}{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Qty<input required name="quantity" type="number" min="0.01" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600">Unit price<input required name="unitPrice" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={`${fieldClass} mt-1`} /></label><div className="self-center text-right font-semibold">{money(Number(quantity) * Number(unitPrice))}</div><div className="flex flex-col gap-1"><button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 underline underline-offset-2">Cancel</button><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Saving…" : "Save"}</button></div></div>{state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}</form></RowShell>;
}

function LaborRow({ invoiceId, line }: { invoiceId: string; line: LaborLine }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(line.description);
  const [hours, setHours] = useState(line.hours);
  const [rate, setRate] = useState(line.hourlyRate);
  const [eligible, setEligible] = useState(line.shopSuppliesEligible);
  const [state, action, pending] = useActionState(updateInvoiceLaborWithState, idle);
  useEffect(() => { if (state.status === "success") setEditing(false); }, [state.status]);

  if (!editing) return <RowShell><div className="grid gap-2 text-sm lg:grid-cols-[7.2rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_7rem_7rem_5.5rem] lg:items-center lg:gap-3"><div><TypeBadge type="labor" /></div><ReadOnlyDescriptionPreview value={line.description} /><div className="text-slate-500">{line.shopSuppliesEligible ? "Shop supplies" : "—"}</div><div className="text-right">{line.hours}</div><div className="text-right">{money(line.hourlyRate)}/hr</div><div className="text-right font-semibold text-slate-950">{money(Number(line.hours) * Number(line.hourlyRate))}</div><div className="flex justify-end gap-1"><button type="button" onClick={() => setEditing(true)} className="px-2 py-2 text-xs font-semibold text-brand-primary underline underline-offset-2">Edit</button><DeleteButton action={deleteInvoiceLabor} invoiceId={invoiceId} lineId={line.id} kind="labor" /></div></div></RowShell>;

  return <RowShell editing tone="bg-emerald-50/40"><form action={action}><input type="hidden" name="invoiceId" value={invoiceId} /><input type="hidden" name="laborId" value={line.id} /><input type="hidden" name="shopSuppliesEligible" value={String(eligible)} /><div className="grid gap-3 lg:grid-cols-[7.2rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_7rem_7rem_5.5rem] lg:items-end"><div className="self-center"><TypeBadge type="labor" /></div><HistoricalDescriptionCombobox kind="labor" rowKey={`invoice-edit-labor-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline /><label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-primary" />Shop supplies</label><label className="text-xs font-semibold text-slate-600">Hours<input required name="hours" type="number" min="0.01" step="0.01" value={hours} onChange={(e) => setHours(e.target.value)} className={`${fieldClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600">Rate<input required name="hourlyRate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={`${fieldClass} mt-1`} /></label><div className="self-center text-right font-semibold">{money(Number(hours) * Number(rate))}</div><div className="flex flex-col gap-1"><button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 underline underline-offset-2">Cancel</button><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Saving…" : "Save"}</button></div></div>{state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}</form></RowShell>;
}

function ComplimentaryRow({ invoiceId, line }: { invoiceId: string; line: ComplimentaryLine }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(line.description);
  const [state, action, pending] = useActionState(updateInvoiceComplimentaryWithState, complimentaryIdle);
  useEffect(() => { if (state.status === "success") setEditing(false); }, [state.status]);

  if (!editing) return <RowShell><div className="grid gap-2 text-sm lg:grid-cols-[7.2rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_7rem_7rem_5.5rem] lg:items-center lg:gap-3"><div><TypeBadge type="complimentary" /></div><ReadOnlyDescriptionPreview value={line.description} /><div className="text-slate-400">—</div><div className="text-right text-slate-400">—</div><div className="text-right text-slate-400">—</div><div className="text-right font-semibold text-emerald-700">No charge</div><div className="flex justify-end gap-1"><button type="button" onClick={() => setEditing(true)} className="px-2 py-2 text-xs font-semibold text-brand-primary underline underline-offset-2">Edit</button><DeleteButton action={deleteInvoiceComplimentary} invoiceId={invoiceId} lineId={line.id} kind="complimentary" /></div></div></RowShell>;

  return <RowShell editing tone="bg-violet-50/40"><form action={action}><input type="hidden" name="invoiceId" value={invoiceId} /><input type="hidden" name="laborId" value={line.id} /><div className="grid gap-3 lg:grid-cols-[7.2rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_7rem_7rem_5.5rem] lg:items-end"><div className="self-center"><TypeBadge type="complimentary" /></div><HistoricalDescriptionCombobox kind="labor" rowKey={`invoice-edit-complimentary-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline /><div className="text-xs text-slate-500 lg:col-span-3">Complimentary services are shown on the invoice at no charge.</div><div className="self-center text-right font-semibold text-emerald-700">No charge</div><div className="flex flex-col gap-1"><button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 underline underline-offset-2">Cancel</button><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Saving…" : "Save"}</button></div></div>{state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}</form></RowShell>;
}

function PresetPicker({ services, selectedId, onSelect, onClear }: { services: CommonService[]; selectedId: string | null; onSelect: (service: CommonService) => void; onClear: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  const quick = services.slice(0, 3);
  const selected = services.find((service) => service.id === selectedId) ?? null;
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? services.filter((service) => `${service.name} ${service.description}`.toLowerCase().includes(q)) : services; }, [query, services]);
  if (!services.length) return null;
  return <div className="mb-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-600">Common services</span>{quick.map((service) => <button key={service.id} type="button" onClick={() => onSelect(service)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedId === service.id ? "border-brand-primary bg-brand-primary text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-primary/50 hover:text-brand-primary"}`}>{service.name}</button>)}{services.length > quick.length ? <button type="button" onClick={() => setMoreOpen((open) => !open)} className="rounded-full border border-dashed border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">More services ({services.length - quick.length})</button> : null}{selected ? <span className="ml-auto text-xs text-slate-500">From preset: <strong className="text-slate-700">{selected.name}</strong> <button type="button" onClick={onClear} className="ml-1 font-semibold text-brand-primary underline underline-offset-2">Clear</button></span> : null}</div>{moreOpen ? <div className="mt-2 max-w-2xl rounded-xl border border-slate-300 bg-white p-3 shadow-sm"><div className="flex gap-2"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search common services…" className={`${fieldClass} flex-1`} /><button type="button" onClick={() => { setMoreOpen(false); setQuery(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600">Close</button></div><div className="mt-2 max-h-52 overflow-y-auto">{filtered.map((service) => <button key={service.id} type="button" onClick={() => { onSelect(service); setMoreOpen(false); setQuery(""); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"><span className="block text-sm font-semibold text-slate-800">{service.name}</span><span className="block text-xs text-slate-500">{service.defaultHours} hrs · {money(service.defaultLaborRate)}</span></button>)}</div></div> : null}</div>;
}

function DraftHeader({ pending }: { pending: boolean }) {
  return <div className="mb-3 flex items-center justify-between gap-3">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Add line item</p>
    <button disabled={pending} className="shrink-0 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Adding…" : "+ Add"}</button>
  </div>;
}

function TypeSelect({ value, onChange }: { value: ItemType; onChange: (value: ItemType) => void }) {
  return <label className="text-xs font-semibold text-slate-600">Type<select value={value} onChange={(e) => onChange(e.target.value as ItemType)} className={`${fieldClass} mt-1 min-w-[10rem] font-semibold`}><option value="part">Part</option><option value="labor">Labor</option><option value="complimentary">Complimentary</option></select></label>;
}

function AmountField({ value, complimentary = false }: { value: string; complimentary?: boolean }) {
  return <div className="text-xs font-semibold text-slate-600"><span>Amount</span><div className={`mt-1 flex min-h-[38px] items-center justify-end text-base font-bold ${complimentary ? "text-emerald-700" : "text-slate-950"}`}>{value}</div></div>;
}

function DraftPart({ invoice, type, setType, onSaved }: { invoice: InvoiceEditModel; type: ItemType; setType: (value: ItemType) => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [state, action, pending] = useActionState(addInvoicePartWithState, idle);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  return <form action={action}>
    <input type="hidden" name="invoiceId" value={invoice.id} />
    <DraftHeader pending={pending} />
    <div className="grid gap-3 lg:grid-cols-[10rem_minmax(17rem,1.45fr)_minmax(11rem,.8fr)_5.5rem_7rem_7rem] lg:items-end">
      <TypeSelect value={type} onChange={setType} />
      <HistoricalDescriptionCombobox kind="part" rowKey="invoice-edit-new-part" value={description} onChange={setDescription} inputClass={descriptionClass} placeholder="Part description" multiline autoGrow />
      <VendorCombobox vendors={invoice.vendors} />
      <label className="text-xs font-semibold text-slate-600">Qty<input required name="quantity" type="number" min="0.01" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Unit price<input required name="unitPrice" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <AmountField value={money(Number(quantity) * Number(unitPrice))} />
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function DraftLabor({ invoice, type, setType, onSaved }: { invoice: InvoiceEditModel; type: ItemType; setType: (value: ItemType) => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState(invoice.defaultLaborRate);
  const [eligible, setEligible] = useState(true);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(addInvoiceLaborWithState, idle);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  const choose = (service: CommonService) => { setPresetId(service.id); setDescription(service.description); setHours(service.defaultHours); setRate(service.defaultLaborRate); setEligible(service.shopSuppliesEligible); };
  const clearPreset = () => { setPresetId(null); setDescription(""); setHours(""); setRate(invoice.defaultLaborRate); setEligible(true); };
  return <form action={action}>
    <input type="hidden" name="invoiceId" value={invoice.id} />
    <input type="hidden" name="shopSuppliesEligible" value={String(eligible)} />
    <DraftHeader pending={pending} />
    <PresetPicker services={invoice.services} selectedId={presetId} onSelect={choose} onClear={clearPreset} />
    <div className="grid gap-3 lg:grid-cols-[10rem_minmax(24rem,2fr)_5.5rem_7rem_7rem] lg:items-end">
      <TypeSelect value={type} onChange={setType} />
      <HistoricalDescriptionCombobox kind="labor" rowKey="invoice-edit-new-labor" value={description} onChange={setDescription} inputClass={descriptionClass} placeholder="Labor description" multiline autoGrow />
      <label className="text-xs font-semibold text-slate-600">Hours<input required name="hours" type="number" min="0.01" step="0.01" value={hours} onChange={(e) => setHours(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Rate<input required name="hourlyRate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={`${fieldClass} mt-1`} /></label>
      <AmountField value={money(Number(hours) * Number(rate))} />
    </div>
    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700 lg:ml-[10.75rem]"><input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />Apply shop supplies to labor</label>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function DraftComplimentary({ invoiceId, type, setType, onSaved }: { invoiceId: string; type: ItemType; setType: (value: ItemType) => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [state, action, pending] = useActionState(addInvoiceComplimentaryWithState, complimentaryIdle);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  return <form action={action}>
    <input type="hidden" name="invoiceId" value={invoiceId} />
    <DraftHeader pending={pending} />
    <div className="grid gap-3 lg:grid-cols-[10rem_minmax(28rem,2fr)_7rem] lg:items-end">
      <TypeSelect value={type} onChange={setType} />
      <HistoricalDescriptionCombobox kind="labor" rowKey="invoice-edit-new-complimentary" value={description} onChange={setDescription} inputClass={descriptionClass} placeholder="Complimentary service description" multiline autoGrow />
      <AmountField value="No charge" complimentary />
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function AddLineItem({ invoice }: { invoice: InvoiceEditModel }) {
  const [type, setType] = useState<ItemType>("part");
  const [version, setVersion] = useState(0);
  return <div className="border-t border-slate-300 bg-slate-50/70 px-4 py-4 sm:px-5">
    {type === "part" ? <DraftPart key={`part-${version}`} invoice={invoice} type={type} setType={setType} onSaved={() => setVersion((v) => v + 1)} /> : null}
    {type === "labor" ? <DraftLabor key={`labor-${version}`} invoice={invoice} type={type} setType={setType} onSaved={() => setVersion((v) => v + 1)} /> : null}
    {type === "complimentary" ? <DraftComplimentary key={`complimentary-${version}`} invoiceId={invoice.id} type={type} setType={setType} onSaved={() => setVersion((v) => v + 1)} /> : null}
  </div>;
}

function FinancialSummary({ invoice }: { invoice: InvoiceEditModel }) {
  const [discount, setDiscount] = useState(invoice.discountAmount);
  const [state, action, pending] = useActionState(updateInvoiceDiscountWithState, idle);
  const row = (label: string, value: string, strong = false) => <><dt className={strong ? "border-t border-slate-200 pt-3 font-semibold text-slate-950" : "text-slate-500"}>{label}</dt><dd className={`text-right tabular-nums ${strong ? "border-t border-slate-200 pt-3 font-semibold text-slate-950" : "text-slate-800"}`}>{money(value)}</dd></>;
  return <aside className="self-start lg:sticky lg:top-6"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Balance due</p><p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{money(invoice.totals.balance)}</p><dl className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 text-sm">{row("Parts", invoice.totals.parts)}{row("Labor", invoice.totals.labor)}{row("Shop supplies", invoice.totals.shopSupplies)}{row("Discount", `-${invoice.totals.discount}`)}{row("Tax", invoice.totals.tax)}{row("Total", invoice.totals.total, true)}{row("Paid", invoice.totals.paid)}{row("Balance", invoice.totals.balance, true)}</dl><form action={action} className="mt-5 border-t border-slate-200 pt-4"><input type="hidden" name="invoiceId" value={invoice.id} /><label className="text-xs font-bold uppercase tracking-wider text-slate-500">Discount<input required name="discountAmount" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${fieldClass} mt-1.5`} /></label><FormSubmitButton disabled={pending || Number(discount) === Number(invoice.discountAmount)} pendingLabel="Saving…" className="mt-2 w-full rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save Discount</FormSubmitButton>{state.status === "success" ? <p className="mt-2 text-xs font-medium text-emerald-700">Discount saved.</p> : state.status === "error" ? <p className="mt-2 text-xs font-medium text-red-700">{state.message}</p> : null}</form></section></aside>;
}

export function InvoiceEditWorkspaceV3({ invoice }: { invoice: InvoiceEditModel }) {
  const [complaint, setComplaint] = useState(invoice.customerComplaint ?? "");
  const [recommendation, setRecommendation] = useState(invoice.recommendation ?? "");
  const [detailsState, detailsAction, detailsPending] = useActionState(updateInvoiceDetailsWithState, idle);
  const totalItems = invoice.parts.length + invoice.labor.length + invoice.complimentary.length;

  return <div className="space-y-5"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><Link href={`/invoices/${invoice.id}`} className="text-sm font-semibold text-brand-primary">← Back to invoice</Link><p className="mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">Invoice</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Edit Invoice — RO #{invoice.repairOrderNumber}</h1><p className="mt-1 text-sm text-slate-600">Update invoice details and line items. Saved changes recalculate the open invoice while preserving recorded payments.</p></div><Link href={`/invoices/${invoice.id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link></header><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><main className="min-w-0 space-y-5"><form action={detailsAction} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><input type="hidden" name="invoiceId" value={invoice.id} /><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-slate-950">Concerns &amp; Recommendations</h2><button disabled={detailsPending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{detailsPending ? "Saving…" : "Save"}</button></div><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Customer Complaint<textarea name="customerComplaint" rows={3} value={complaint} onChange={(e) => setComplaint(e.target.value)} className={`${fieldClass} mt-1 resize-y`} /></label><label className="text-xs font-semibold text-slate-600">Service Recommendation<textarea name="recommendation" rows={3} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} className={`${fieldClass} mt-1 resize-y`} /></label></div>{detailsState.status === "error" ? <p className="mt-2 text-sm text-red-700">{detailsState.message}</p> : detailsState.status === "success" ? <p className="mt-2 text-sm text-emerald-700">Invoice details saved.</p> : null}</form><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5"><div><h2 className="font-semibold text-slate-950">Line items</h2><p className="mt-0.5 text-xs text-slate-500">{totalItems} item{totalItems === 1 ? "" : "s"}</p></div><div className="text-sm font-semibold text-slate-600">Parts {money(invoice.totals.parts)} <span className="px-1.5 text-slate-300">·</span> Labor {money(invoice.totals.labor)}</div></div><div className="hidden border-t border-slate-200 bg-slate-50 px-5 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 lg:grid lg:grid-cols-[7.2rem_minmax(12rem,1fr)_minmax(8rem,.55fr)_5rem_7rem_7rem_5.5rem] lg:gap-3"><span>Type</span><span>Description</span><span>Vendor / Supplies</span><span className="text-right">Qty / Hrs</span><span className="text-right">Price / Rate</span><span className="text-right">Amount</span><span /></div>{invoice.parts.map((line) => <PartRow key={line.id} invoiceId={invoice.id} line={line} vendors={invoice.vendors} />)}{invoice.labor.map((line) => <LaborRow key={line.id} invoiceId={invoice.id} line={line} />)}{invoice.complimentary.map((line) => <ComplimentaryRow key={line.id} invoiceId={invoice.id} line={line} />)}<AddLineItem invoice={invoice} /></section></main><FinancialSummary invoice={invoice} /></div></div>;
}
