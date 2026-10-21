"use client";

import { useActionState, useEffect, useState } from "react";
import { addLaborLineWithState, deleteLaborLine, updateLaborLineWithState, type LaborActionState } from "@/app/(app)/repair-orders/labor-actions";
import { addComplimentaryServiceWithState, deleteComplimentaryService, updateComplimentaryServiceWithState, type ComplimentaryServiceActionState } from "@/app/(app)/repair-orders/complimentary-service-actions";
import { addPartLineWithState, deletePartLine, updatePartLineWithState } from "@/app/(app)/repair-orders/part-actions";
import { reorderRepairOrderLine } from "@/app/(app)/repair-orders/reorder-line-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PendingIcon, TrashIcon } from "@/components/line-item-layout";
import { VendorCombobox, type VendorOption } from "@/components/vendor-combobox";
import { HistoricalDescriptionCombobox, ReadOnlyDescriptionPreview } from "@/components/historical-description-combobox";
import type { PartActionState } from "@/components/part-action-form";

type PartLine = { id: string; description: string; quantity: string; unitPrice: string; vendor: VendorOption | null };
type LaborLine = { id: string; description: string; hours: string; hourlyRate: string; shopSuppliesEligible: boolean };
type CommonService = { id: string; name: string; description: string; defaultHours: string; defaultLaborRate: string; shopSuppliesEligible: boolean };
type LineType = "part" | "labor" | "complimentary";

const idlePart: PartActionState = { status: "idle" };
const idleLabor: LaborActionState = { status: "idle" };
const idleComplimentary: ComplimentaryServiceActionState = { status: "idle" };
const inputClass = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
const descriptionClass = `${inputClass} resize-none overflow-y-hidden whitespace-pre-wrap break-words leading-5`;
const laborDescriptionWrapperClass = "[&>div>div:first-child>span:last-child]:hidden";
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);
const decimalPattern = "[0-9]*[.]?[0-9]+";

export function RepairOrderUnifiedLineItems({ repairOrderId, partsTotal, laborTotal, parts, labor, complimentary, vendors, services, defaultRate, editable }: {
  repairOrderId: string;
  partsTotal: string;
  laborTotal: string;
  parts: PartLine[];
  labor: LaborLine[];
  complimentary: Array<Pick<LaborLine, "id" | "description">>;
  vendors: VendorOption[];
  services: CommonService[];
  defaultRate: string;
  editable: boolean;
}) {
  const [draftKey, setDraftKey] = useState(0);
  return <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
      <div>
        <h2 className="text-base font-bold text-slate-950">Line items</h2>
        <p className="mt-1 text-xs text-slate-500">Parts use quantity × unit price. Labor uses hours × rate. Use ↑/↓ to order Parts within Parts and Labor within Labor.</p>
      </div>
      <p className="text-sm font-semibold text-slate-700">Parts {money(Number(partsTotal))} <span className="mx-1 text-slate-300">·</span> Labor {money(Number(laborTotal))}</p>
    </div>
    <div className="hidden grid-cols-[6.5rem_minmax(13rem,1fr)_minmax(9rem,.65fr)_5.5rem_7rem_7rem_4.5rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 lg:grid sm:px-5">
      <span>Type</span><span>Description</span><span>Vendor / service</span><span className="text-right">Qty / hrs</span><span className="text-right">Price / rate</span><span className="text-right">Amount</span><span />
    </div>
    <div className="divide-y divide-slate-200">
      {parts.map((line, index) => <PartSavedRow key={line.id} repairOrderId={repairOrderId} line={line} vendors={vendors} editable={editable} canMoveUp={index > 0} canMoveDown={index < parts.length - 1} />)}
      {labor.map((line, index) => <LaborSavedRow key={line.id} repairOrderId={repairOrderId} line={line} services={services} editable={editable} canMoveUp={index > 0} canMoveDown={index < labor.length - 1} />)}
      {complimentary.map((line) => <ComplimentarySavedRow key={line.id} repairOrderId={repairOrderId} line={line} editable={editable} />)}
      {!parts.length && !labor.length && !complimentary.length ? <p className="px-4 py-5 text-sm text-slate-500 sm:px-5">No line items yet.</p> : null}
    </div>
    {editable ? <div className="border-t border-slate-300 bg-slate-50/70 px-4 py-4 sm:px-5"><DraftLineItem key={draftKey} repairOrderId={repairOrderId} vendors={vendors} services={services} defaultRate={defaultRate} onSaved={() => setDraftKey((key) => key + 1)} /></div> : null}
  </section>;
}

function TypeBadge({ type }: { type: LineType }) {
  const label = type === "part" ? "Part" : type === "labor" ? "Labor" : "Complimentary";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${type === "part" ? "bg-blue-50 text-blue-800" : type === "labor" ? "bg-emerald-50 text-emerald-800" : "bg-violet-50 text-violet-800"}`}>{label}</span>;
}

function ReorderControls({ repairOrderId, lineId, lineType, canMoveUp, canMoveDown }: { repairOrderId: string; lineId: string; lineType: "part" | "labor"; canMoveUp: boolean; canMoveDown: boolean }) {
  const buttonClass = "inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-black text-brand-primary hover:bg-brand-subtle disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent";
  return <div className="flex shrink-0 flex-col" aria-label={`Reorder ${lineType}`}>
    <form action={reorderRepairOrderLine}>
      <input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="lineId" value={lineId} /><input type="hidden" name="lineType" value={lineType} /><input type="hidden" name="direction" value="up" />
      <button type="submit" disabled={!canMoveUp} title={`Move ${lineType} up`} aria-label={`Move ${lineType} up`} className={buttonClass}>▲</button>
    </form>
    <form action={reorderRepairOrderLine}>
      <input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="lineId" value={lineId} /><input type="hidden" name="lineType" value={lineType} /><input type="hidden" name="direction" value="down" />
      <button type="submit" disabled={!canMoveDown} title={`Move ${lineType} down`} aria-label={`Move ${lineType} down`} className={buttonClass}>▼</button>
    </form>
  </div>;
}

function DisplayRow({ type, description, secondary, qty, rate, amount, actions, reorder }: { type: LineType; description: string; secondary: string; qty: string; rate: string; amount: string; actions: React.ReactNode; reorder?: React.ReactNode }) {
  return <div className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[6.5rem_minmax(13rem,1fr)_minmax(9rem,.65fr)_5.5rem_7rem_7rem_4.5rem] lg:items-center lg:gap-3 sm:px-5">
    <div className="flex items-center gap-1"><TypeBadge type={type} />{reorder}</div>
    <ReadOnlyDescriptionPreview value={description} />
    <div className="text-slate-500">{secondary}</div>
    <div className="flex justify-between gap-3 lg:block lg:text-right"><span className="text-slate-500 lg:hidden">Qty / hrs</span><span>{qty}</span></div>
    <div className="flex justify-between gap-3 lg:block lg:text-right"><span className="text-slate-500 lg:hidden">Price / rate</span><span>{rate}</span></div>
    <div className="flex justify-between gap-3 font-semibold text-slate-950 lg:block lg:text-right"><span className="text-slate-500 lg:hidden">Amount</span><span>{amount}</span></div>
    <div className="flex justify-end gap-1">{actions}</div>
  </div>;
}

function RowActions({ onEdit, deleteAction, deleteLabel, hiddenInputs }: { onEdit: () => void; deleteAction: (formData: FormData) => Promise<void>; deleteLabel: string; hiddenInputs: React.ReactNode }) {
  return <>
    <button type="button" onClick={onEdit} className="px-2 py-2 text-xs font-semibold text-brand-primary underline underline-offset-2">Edit</button>
    <form action={deleteAction}>{hiddenInputs}<FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel={`Deleting ${deleteLabel}`} confirmMessage={`Delete ${deleteLabel}?`} destructive title={`Delete ${deleteLabel}`} ariaLabel={`Delete ${deleteLabel}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"><TrashIcon /></FormSubmitButton></form>
  </>;
}

function EditActions({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  return <div className="flex flex-col items-stretch gap-1">
    <button type="button" onClick={onClose} disabled={pending} className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50">Cancel</button>
    <button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white">{pending ? "Saving…" : "Save"}</button>
  </div>;
}

function PartSavedRow({ repairOrderId, line, vendors, editable, canMoveUp, canMoveDown }: { repairOrderId: string; line: PartLine; vendors: VendorOption[]; editable: boolean; canMoveUp: boolean; canMoveDown: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing && editable) return <PartEditRow repairOrderId={repairOrderId} line={line} vendors={vendors} onClose={() => setEditing(false)} />;
  return <DisplayRow type="part" description={line.description} secondary={line.vendor?.name ?? "—"} qty={line.quantity} rate={money(Number(line.unitPrice))} amount={money(Number(line.quantity) * Number(line.unitPrice))} reorder={editable ? <ReorderControls repairOrderId={repairOrderId} lineId={line.id} lineType="part" canMoveUp={canMoveUp} canMoveDown={canMoveDown} /> : null} actions={editable ? <RowActions onEdit={() => setEditing(true)} deleteAction={deletePartLine} deleteLabel="part" hiddenInputs={<><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="partLineId" value={line.id} /></>} /> : null} />;
}

function PartEditRow({ repairOrderId, line, vendors, onClose }: { repairOrderId: string; line: PartLine; vendors: VendorOption[]; onClose: () => void }) {
  const [description, setDescription] = useState(line.description);
  const [quantity, setQuantity] = useState(line.quantity);
  const [unitPrice, setUnitPrice] = useState(line.unitPrice);
  const [state, action, pending] = useActionState(updatePartLineWithState, idlePart);
  useEffect(() => { if (state.status === "success") onClose(); }, [state.status, onClose]);
  return <form action={action} className="bg-blue-50/40 px-4 py-4 sm:px-5">
    <input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="partLineId" value={line.id} />
    <div className="grid gap-3 lg:grid-cols-[6.5rem_minmax(13rem,1fr)_minmax(9rem,.65fr)_5.5rem_7rem_7rem_4.5rem] lg:items-end">
      <div><TypeBadge type="part" /></div>
      <HistoricalDescriptionCombobox kind="part" rowKey={`edit-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline autoGrow />
      <VendorCombobox vendors={vendors} defaultVendor={line.vendor} />
      <label className="text-xs font-semibold text-slate-600">Qty<input name="quantity" type="text" inputMode="decimal" pattern={decimalPattern} required value={quantity} onChange={(e) => setQuantity(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Qty.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Unit price<input name="unitPrice" type="text" inputMode="decimal" pattern={decimalPattern} required value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Unit price.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <div className="self-center text-right font-semibold">{money(Number(quantity) * Number(unitPrice))}</div>
      <EditActions pending={pending} onClose={onClose} />
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function LaborSavedRow({ repairOrderId, line, services, editable, canMoveUp, canMoveDown }: { repairOrderId: string; line: LaborLine; services: CommonService[]; editable: boolean; canMoveUp: boolean; canMoveDown: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing && editable) return <LaborEditRow repairOrderId={repairOrderId} line={line} services={services} onClose={() => setEditing(false)} />;
  return <DisplayRow type="labor" description={line.description} secondary={line.shopSuppliesEligible ? "Shop supplies" : "—"} qty={line.hours} rate={money(Number(line.hourlyRate))} amount={money(Number(line.hours) * Number(line.hourlyRate))} reorder={editable ? <ReorderControls repairOrderId={repairOrderId} lineId={line.id} lineType="labor" canMoveUp={canMoveUp} canMoveDown={canMoveDown} /> : null} actions={editable ? <RowActions onEdit={() => setEditing(true)} deleteAction={deleteLaborLine} deleteLabel="labor" hiddenInputs={<><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="laborLineId" value={line.id} /></>} /> : null} />;
}

function LaborPresetPicker({ services, selectedId, modified, onSelect, onClear }: { services: CommonService[]; selectedId: string | null; modified: boolean; onSelect: (service: CommonService) => void; onClear: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  const quick = services.slice(0, 3);
  const remaining = Math.max(0, services.length - quick.length);
  const selected = selectedId ? services.find((service) => service.id === selectedId) ?? null : null;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery ? services.filter((service) => service.name.toLowerCase().includes(normalizedQuery) || service.description.toLowerCase().includes(normalizedQuery)) : services;

  if (!services.length) return null;
  return <div className="mb-3">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600">Common services</span>
        {quick.map((service) => <button key={service.id} type="button" onClick={() => { onSelect(service); setMoreOpen(false); }} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selectedId === service.id ? "border-brand-primary bg-brand-primary text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-primary/50 hover:text-brand-primary"}`}>{service.name}</button>)}
        {remaining > 0 ? <button type="button" onClick={() => setMoreOpen((open) => !open)} className="rounded-full border border-dashed border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-primary hover:text-brand-primary">More services ({remaining})</button> : null}
      </div>
      {selected ? <div className="text-xs text-slate-500">From preset: <span className="font-semibold text-slate-700">{selected.name}</span>{modified ? <span className="font-semibold text-amber-700"> · Modified</span> : null} <button type="button" onClick={onClear} className="ml-1 font-semibold text-brand-primary underline underline-offset-2">Clear preset</button></div> : null}
    </div>
    {moreOpen ? <div className="mt-2 max-w-2xl rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search common services…" className={`${inputClass} flex-1`} autoFocus />
        <button type="button" onClick={() => { setMoreOpen(false); setQuery(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Close</button>
      </div>
      <div className="mt-2 max-h-52 overflow-y-auto">
        {filtered.length ? filtered.map((service) => <button key={service.id} type="button" onClick={() => { onSelect(service); setMoreOpen(false); setQuery(""); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">
          <span className="block text-sm font-semibold text-slate-800">{service.name}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{service.defaultHours} hrs · {money(Number(service.defaultLaborRate))}{service.shopSuppliesEligible ? " · Shop supplies" : ""}</span>
        </button>) : <p className="px-3 py-3 text-sm text-slate-500">No matching services.</p>}
      </div>
    </div> : null}
  </div>;
}

function LaborEditRow({ repairOrderId, line, services, onClose }: { repairOrderId: string; line: LaborLine; services: CommonService[]; onClose: () => void }) {
  const [description, setDescription] = useState(line.description);
  const [hours, setHours] = useState(line.hours);
  const [rate, setRate] = useState(line.hourlyRate);
  const [eligible, setEligible] = useState(line.shopSuppliesEligible);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(updateLaborLineWithState, idleLabor);
  useEffect(() => { if (state.status === "success") onClose(); }, [state.status, onClose]);
  const selectedPreset = selectedPresetId ? services.find((service) => service.id === selectedPresetId) ?? null : null;
  const presetModified = selectedPreset ? description !== selectedPreset.description || hours !== selectedPreset.defaultHours || rate !== selectedPreset.defaultLaborRate || eligible !== selectedPreset.shopSuppliesEligible : false;
  function chooseService(service: CommonService) {
    setSelectedPresetId(service.id);
    setDescription(service.description);
    setHours(service.defaultHours);
    setRate(service.defaultLaborRate);
    setEligible(service.shopSuppliesEligible);
  }
  function clearPreset() {
    setSelectedPresetId(null);
    setDescription(line.description);
    setHours(line.hours);
    setRate(line.hourlyRate);
    setEligible(line.shopSuppliesEligible);
  }
  return <form action={action} className="bg-emerald-50/40 px-4 py-4 sm:px-5">
    <input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="laborLineId" value={line.id} /><input type="hidden" name="shopSuppliesEligible" value={String(eligible)} />
    <LaborPresetPicker services={services} selectedId={selectedPresetId} modified={presetModified} onSelect={chooseService} onClear={clearPreset} />
    <div className="grid gap-3 lg:grid-cols-[6.5rem_minmax(18rem,1.7fr)_5.5rem_7rem_7rem_4.5rem] lg:items-end">
      <div><TypeBadge type="labor" /></div>
      <div className={laborDescriptionWrapperClass}><HistoricalDescriptionCombobox kind="labor" rowKey={`edit-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline autoGrow /></div>
      <label className="text-xs font-semibold text-slate-600">Hours<input name="hours" type="text" inputMode="decimal" pattern={decimalPattern} required value={hours} onChange={(e) => setHours(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Hours.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Rate<input name="hourlyRate" type="text" inputMode="decimal" pattern={decimalPattern} required value={rate} onChange={(e) => setRate(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Rate.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <div className="self-center text-right font-semibold">{money(Number(hours) * Number(rate))}</div>
      <EditActions pending={pending} onClose={onClose} />
    </div>
    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />Apply shop supplies to labor</label>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function ComplimentarySavedRow({ repairOrderId, line, editable }: { repairOrderId: string; line: Pick<LaborLine, "id" | "description">; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing && editable) return <ComplimentaryEditRow repairOrderId={repairOrderId} line={line} onClose={() => setEditing(false)} />;
  return <DisplayRow type="complimentary" description={line.description} secondary="No charge" qty="—" rate="—" amount={money(0)} actions={editable ? <RowActions onEdit={() => setEditing(true)} deleteAction={deleteComplimentaryService} deleteLabel="complimentary service" hiddenInputs={<><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="laborLineId" value={line.id} /></>} /> : null} />;
}

function ComplimentaryEditRow({ repairOrderId, line, onClose }: { repairOrderId: string; line: Pick<LaborLine, "id" | "description">; onClose: () => void }) {
  const [description, setDescription] = useState(line.description);
  const [state, action, pending] = useActionState(updateComplimentaryServiceWithState, idleComplimentary);
  useEffect(() => { if (state.status === "success") onClose(); }, [state.status, onClose]);
  return <form action={action} className="bg-violet-50/40 px-4 py-4 sm:px-5">
    <input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="laborLineId" value={line.id} />
    <div className="grid gap-3 lg:grid-cols-[10rem_minmax(22rem,1.8fr)_7rem_4.5rem] lg:items-end">
      <div><TypeBadge type="complimentary" /></div>
      <HistoricalDescriptionCombobox kind="labor" rowKey={`edit-comp-${line.id}`} value={description} onChange={setDescription} inputClass={descriptionClass} multiline autoGrow />
      <div className="pb-2 text-right font-semibold">{money(0)}</div>
      <EditActions pending={pending} onClose={onClose} />
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function DraftLineItem({ repairOrderId, vendors, services, defaultRate, onSaved }: { repairOrderId: string; vendors: VendorOption[]; services: CommonService[]; defaultRate: string; onSaved: () => void }) {
  const [type, setType] = useState<LineType>("part");
  return <div>
    {type === "part" ? <DraftPart repairOrderId={repairOrderId} vendors={vendors} type={type} setType={setType} onSaved={onSaved} /> : null}
    {type === "labor" ? <DraftLabor repairOrderId={repairOrderId} services={services} defaultRate={defaultRate} type={type} setType={setType} onSaved={onSaved} /> : null}
    {type === "complimentary" ? <DraftComplimentary repairOrderId={repairOrderId} type={type} setType={setType} onSaved={onSaved} /> : null}
  </div>;
}

function DraftHeader({ pending }: { pending: boolean }) {
  return <div className="mb-3 flex items-center justify-between gap-3">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Add line item</p>
    <button disabled={pending} className="shrink-0 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Adding…" : "+ Add"}</button>
  </div>;
}

function TypeSelect({ value, onChange }: { value: LineType; onChange: (value: LineType) => void }) {
  return <label className="text-xs font-semibold text-slate-600">Type<select value={value} onChange={(e) => onChange(e.target.value as LineType)} className={`${inputClass} mt-1 min-w-[10rem]`}><option value="part">Part</option><option value="labor">Labor</option><option value="complimentary">Complimentary</option></select></label>;
}

function AmountField({ value }: { value: string }) {
  return <div className="text-xs font-semibold text-slate-600"><span>Amount</span><div className="mt-1 flex min-h-[38px] items-center justify-end text-base font-bold text-slate-950">{value}</div></div>;
}

function DraftPart({ repairOrderId, vendors, type, setType, onSaved }: { repairOrderId: string; vendors: VendorOption[]; type: LineType; setType: (value: LineType) => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [state, action, pending] = useActionState(addPartLineWithState, idlePart);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  return <form action={action}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <DraftHeader pending={pending} />
    <div className="grid gap-3 lg:grid-cols-[10rem_minmax(17rem,1.45fr)_minmax(11rem,.8fr)_5.5rem_7rem_7rem] lg:items-end">
      <TypeSelect value={type} onChange={setType} />
      <HistoricalDescriptionCombobox kind="part" rowKey="draft-unified-part" value={description} onChange={setDescription} inputClass={descriptionClass} placeholder="Part description" multiline autoGrow />
      <VendorCombobox vendors={vendors} />
      <label className="text-xs font-semibold text-slate-600">Qty<input name="quantity" type="text" inputMode="decimal" pattern={decimalPattern} required value={quantity} onChange={(e) => setQuantity(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Qty.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Unit price<input name="unitPrice" type="text" inputMode="decimal" pattern={decimalPattern} required value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Unit price.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <AmountField value={money(Number(quantity) * Number(unitPrice))} />
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function DraftLabor({ repairOrderId, services, defaultRate, type, setType, onSaved }: { repairOrderId: string; services: CommonService[]; defaultRate: string; type: LineType; setType: (value: LineType) => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [hours, setHours] = useState("1");
  const [rate, setRate] = useState(defaultRate);
  const [eligible, setEligible] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(addLaborLineWithState, idleLabor);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  const selectedPreset = selectedPresetId ? services.find((service) => service.id === selectedPresetId) ?? null : null;
  const presetModified = selectedPreset ? description !== selectedPreset.description || hours !== selectedPreset.defaultHours || rate !== selectedPreset.defaultLaborRate || eligible !== selectedPreset.shopSuppliesEligible : false;
  function chooseService(service: CommonService) {
    setSelectedPresetId(service.id);
    setDescription(service.description);
    setHours(service.defaultHours);
    setRate(service.defaultLaborRate);
    setEligible(service.shopSuppliesEligible);
  }
  function clearPreset() {
    setSelectedPresetId(null);
    setDescription("");
    setHours("1");
    setRate(defaultRate);
    setEligible(true);
  }
  return <form action={action}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="shopSuppliesEligible" value={String(eligible)} />
    <DraftHeader pending={pending} />
    <LaborPresetPicker services={services} selectedId={selectedPresetId} modified={presetModified} onSelect={chooseService} onClear={clearPreset} />
    <div className="grid gap-3 lg:grid-cols-[10rem_minmax(24rem,2fr)_5.5rem_7rem_7rem] lg:items-end">
      <TypeSelect value={type} onChange={setType} />
      <div className={laborDescriptionWrapperClass}><HistoricalDescriptionCombobox kind="labor" rowKey="draft-unified-labor" value={description} onChange={setDescription} inputClass={descriptionClass} placeholder="Labor description" multiline autoGrow /></div>
      <label className="text-xs font-semibold text-slate-600">Hours<input name="hours" type="text" inputMode="decimal" pattern={decimalPattern} required value={hours} onChange={(e) => setHours(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Hours.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">Rate<input name="hourlyRate" type="text" inputMode="decimal" pattern={decimalPattern} required value={rate} onChange={(e) => setRate(e.target.value)} onInput={(e) => e.currentTarget.setCustomValidity("")} onInvalid={(e) => e.currentTarget.setCustomValidity("Enter a number for Rate.")} onWheel={(e) => e.currentTarget.blur()} className={`${inputClass} mt-1`} /></label>
      <AmountField value={money(Number(hours) * Number(rate))} />
    </div>
    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700 lg:ml-[10.75rem]"><input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />Apply shop supplies to labor</label>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}

function DraftComplimentary({ repairOrderId, type, setType, onSaved }: { repairOrderId: string; type: LineType; setType: (value: LineType) => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [state, action, pending] = useActionState(addComplimentaryServiceWithState, idleComplimentary);
  useEffect(() => { if (state.status === "success") onSaved(); }, [state.status, onSaved]);
  return <form action={action}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <DraftHeader pending={pending} />
    <div className="grid gap-3 lg:grid-cols-[10rem_minmax(28rem,2fr)_7rem] lg:items-end">
      <TypeSelect value={type} onChange={setType} />
      <HistoricalDescriptionCombobox kind="labor" rowKey="draft-unified-complimentary" value={description} onChange={setDescription} inputClass={descriptionClass} placeholder="Complimentary service description" multiline autoGrow />
      <AmountField value={money(0)} />
    </div>
    {state.status === "error" ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
  </form>;
}
