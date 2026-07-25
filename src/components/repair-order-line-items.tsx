"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { addLaborLineWithState, deleteLaborLine, updateLaborLineWithState, type LaborActionState } from "@/app/(app)/repair-orders/labor-actions";
import { addPartLineWithState, deletePartLine, updatePartLineWithState } from "@/app/(app)/repair-orders/part-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { addLineItemButtonClass, CheckIcon, ClearLineItemButton, deleteLineItemButtonClass, laborLineItemRowClass, LineItemAmountActions, partLineItemRowClass, PendingIcon, PlusIcon, saveLineItemButtonClass, TrashIcon } from "@/components/line-item-layout";
import { PartActionForm } from "@/components/part-action-form";
import { VendorCombobox, type VendorOption } from "@/components/vendor-combobox";

type PartLine = { id: string; description: string; quantity: string; unitPrice: string; vendor: VendorOption | null };
type LaborLine = { id: string; description: string; hours: string; hourlyRate: string };
type CommonService = { id: string; name: string; description: string; defaultHours: string; defaultLaborRate: string };

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);

function SavedDeleteButton({ action, label }: { action: (formData: FormData) => Promise<void>; label: string }) {
  return <FormSubmitButton formAction={action} pendingLabel={<PendingIcon />} pendingAriaLabel={label.replace("Delete", "Deleting")} confirmMessage={`${label}?`} destructive title={label} ariaLabel={label} className={deleteLineItemButtonClass}><TrashIcon /></FormSubmitButton>;
}

export function RepairOrderPartsCard({ repairOrderId, total, lines, vendors, editable }: { repairOrderId: string; total: string; lines: PartLine[]; vendors: VendorOption[]; editable: boolean }) {
  const [draftVersion, setDraftVersion] = useState(0);
  return <fieldset disabled={!editable} className="ro-line-card min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm disabled:bg-slate-50 disabled:opacity-75">
    <div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Parts</h2><p className="mt-1 text-sm text-slate-600">Amount is calculated from quantity × unit price.</p></div><p className="font-semibold text-slate-950">{money(Number(total))}</p></div>
    {lines.length > 0 && <div className="space-y-3">{lines.map((line) => <SavedPartRow key={line.id} repairOrderId={repairOrderId} line={line} vendors={vendors} />)}</div>}
    {editable && <div className="border-t border-slate-200 pt-4"><DraftPartRow key={draftVersion} repairOrderId={repairOrderId} vendors={vendors} onReset={() => setDraftVersion((version) => version + 1)} /></div>}
  </fieldset>;
}

function SavedPartRow({ repairOrderId, line, vendors }: { repairOrderId: string; line: PartLine; vendors: VendorOption[] }) {
  const [description, setDescription] = useState(line.description); const [quantity, setQuantity] = useState(line.quantity); const [unitPrice, setUnitPrice] = useState(line.unitPrice); const [vendorChanged, setVendorChanged] = useState(false); const [saved, setSaved] = useState({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice });
  const dirty = vendorChanged || description !== saved.description || quantity !== saved.quantity || unitPrice !== saved.unitPrice;
  return <PartActionForm action={updatePartLineWithState} onSuccess={() => { setSaved({ description, quantity, unitPrice }); setVendorChanged(false); }} className={`${partLineItemRowClass} rounded-lg border border-slate-200 p-3`}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="partLineId" value={line.id} />
    <label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} /></label>
    <VendorCombobox vendors={vendors} defaultVendor={line.vendor} onValueChange={() => setVendorChanged(true)} />
    <label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputClass} /></label>
    <label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className={inputClass} /></label>
    <LineItemAmountActions amount={Number(quantity) * Number(unitPrice)}><FormSubmitButton disabled={!dirty} pendingLabel={<PendingIcon />} pendingAriaLabel="Saving part" ariaLabel="Save part" title="Save part" className={saveLineItemButtonClass}><CheckIcon /></FormSubmitButton><SavedDeleteButton action={deletePartLine} label="Delete part" /></LineItemAmountActions>
  </PartActionForm>;
}

function DraftPartRow({ repairOrderId, vendors, onReset }: { repairOrderId: string; vendors: VendorOption[]; onReset: () => void }) {
  const [quantity, setQuantity] = useState("1"); const [unitPrice, setUnitPrice] = useState("");
  return <PartActionForm action={addPartLineWithState} onSuccess={onReset} className={`${partLineItemRowClass} rounded-lg border border-slate-200 bg-slate-50/40 p-3`}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} /><label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} placeholder="Part description" className={inputClass} /></label><VendorCombobox vendors={vendors} /><label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputClass} /></label><label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className={inputClass} /></label><LineItemAmountActions amount={Number(quantity) * Number(unitPrice)}><FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel="Adding part" ariaLabel="Add part" title="Add part" className={addLineItemButtonClass}><PlusIcon /></FormSubmitButton><ClearLineItemButton label="Clear part" onClear={onReset} /></LineItemAmountActions>
  </PartActionForm>;
}

export function RepairOrderLaborCard({ repairOrderId, total, lines, services, defaultRate, editable }: { repairOrderId: string; total: string; lines: LaborLine[]; services: CommonService[]; defaultRate: string; editable: boolean }) {
  const [draftVersion, setDraftVersion] = useState(0);
  return <fieldset disabled={!editable} className="ro-line-card min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm disabled:bg-slate-50 disabled:opacity-75"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Labor</h2><p className="mt-1 text-sm text-slate-600">Search Common Services or enter a custom description. Amount is hours × rate.</p></div><p className="font-semibold text-slate-950">{money(Number(total))}</p></div>{lines.length > 0 && <div className="space-y-3">{lines.map((line) => <SavedLaborRow key={line.id} repairOrderId={repairOrderId} line={line} services={services} />)}</div>}{editable && <div className="border-t border-slate-200 pt-4"><DraftLaborRow key={draftVersion} repairOrderId={repairOrderId} services={services} defaultRate={defaultRate} onReset={() => setDraftVersion((version) => version + 1)} /></div>}</fieldset>;
}

function LaborActionForm({ action, children, onSuccess }: { action: (state: LaborActionState, formData: FormData) => Promise<LaborActionState>; children: React.ReactNode; onSuccess?: () => void }) {
  const [state, formAction] = useActionState(action, { status: "idle" } as LaborActionState);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { if (state.status === "success") onSuccessRef.current?.(); }, [state]);
  return <form action={formAction} className={`${laborLineItemRowClass} rounded-lg border border-slate-200 p-3`}>{children}<div aria-live="polite" className="sm:col-span-full">{state.status === "error" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{state.message}</p>}{state.status === "success" && <p className="text-sm font-medium text-emerald-700">Saved.</p>}</div></form>;
}

function SavedLaborRow({ repairOrderId, line, services }: { repairOrderId: string; line: LaborLine; services: CommonService[] }) {
  const [description, setDescription] = useState(line.description); const [hours, setHours] = useState(line.hours); const [rate, setRate] = useState(line.hourlyRate); const [saved, setSaved] = useState(line);
  const dirty = description !== saved.description || hours !== saved.hours || rate !== saved.hourlyRate;
  return <LaborActionForm action={updateLaborLineWithState} onSuccess={() => setSaved({ ...line, description, hours, hourlyRate: rate })}><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="laborLineId" value={line.id} /><ServiceCombobox services={services} value={description} onChange={setDescription} onSelect={(service) => { setDescription(service.description); setHours(service.defaultHours); setRate(service.defaultLaborRate); }} /><label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" value={hours} onChange={(event) => setHours(event.target.value)} className={inputClass} /></label><label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} className={inputClass} /></label><LineItemAmountActions amount={Number(hours) * Number(rate)}><FormSubmitButton disabled={!dirty} pendingLabel={<PendingIcon />} pendingAriaLabel="Saving labor" ariaLabel="Save labor" title="Save labor" className={saveLineItemButtonClass}><CheckIcon /></FormSubmitButton><SavedDeleteButton action={deleteLaborLine} label="Delete labor" /></LineItemAmountActions></LaborActionForm>;
}

function DraftLaborRow({ repairOrderId, services, defaultRate, onReset }: { repairOrderId: string; services: CommonService[]; defaultRate: string; onReset: () => void }) {
  const [description, setDescription] = useState(""); const [hours, setHours] = useState(""); const [rate, setRate] = useState(defaultRate);
  return <LaborActionForm action={addLaborLineWithState} onSuccess={onReset}><input type="hidden" name="repairOrderId" value={repairOrderId} /><ServiceCombobox services={services} value={description} onChange={setDescription} onSelect={(service) => { setDescription(service.description); setHours(service.defaultHours); setRate(service.defaultLaborRate); }} /><label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" value={hours} onChange={(event) => setHours(event.target.value)} className={inputClass} /></label><label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} className={inputClass} /></label><LineItemAmountActions amount={Number(hours) * Number(rate)}><FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel="Adding labor" ariaLabel="Add labor" title="Add labor" className={addLineItemButtonClass}><PlusIcon /></FormSubmitButton><ClearLineItemButton label="Clear labor" onClear={onReset} /></LineItemAmountActions></LaborActionForm>;
}

function ServiceCombobox({ services, value, onChange, onSelect }: { services: CommonService[]; value: string; onChange: (value: string) => void; onSelect: (service: CommonService) => void }) {
  const inputId = useId(); const listId = `${inputId}-services`; const [open, setOpen] = useState(false); const [active, setActive] = useState(0); const [selectedName, setSelectedName] = useState<string | null>(null);
  const matches = useMemo(() => { const query = value.trim().toLocaleLowerCase(); return services.filter((service) => !query || service.name.toLocaleLowerCase().includes(query) || service.description.toLocaleLowerCase().includes(query)); }, [services, value]);
  const choose = (service: CommonService) => { onSelect(service); setSelectedName(service.name); setOpen(false); };
  return <label htmlFor={inputId} className="relative z-20 min-w-0 text-sm font-semibold text-slate-700 focus-within:z-40">Service / description{selectedName && <span className="ml-2 rounded-full bg-brand-subtle px-2 py-0.5 text-xs text-brand-primary">Common Service: {selectedName}</span>}<input id={inputId} name="description" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && matches.length ? `${inputId}-service-${active}` : undefined} autoComplete="off" required maxLength={500} value={value} placeholder="Search services or enter labor" onFocus={() => { setOpen(true); setActive(0); }} onBlur={() => setOpen(false)} onChange={(event) => { onChange(event.target.value); setSelectedName(null); setOpen(true); setActive(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((index) => matches.length ? (index + 1) % matches.length : 0); } else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive((index) => matches.length ? (index - 1 + matches.length) % matches.length : 0); } else if (event.key === "Enter" && open && matches[active]) { event.preventDefault(); choose(matches[active]); } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); } }} className={inputClass} />{open && <div id={listId} role="listbox" aria-label="Common Services" className="absolute left-0 z-50 mt-1 max-h-56 w-full min-w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 font-normal shadow-lg">{matches.map((service, index) => <button key={service.id} id={`${inputId}-service-${index}`} type="button" role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(service)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${active === index ? "bg-brand-subtle text-brand-primary" : "text-slate-700 hover:bg-slate-50"}`}><span className="block font-semibold">{service.name}</span><span className="block truncate text-xs text-slate-500">{service.description} · {service.defaultHours} hr at {money(Number(service.defaultLaborRate))}</span></button>)}{matches.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No matching Common Services. Your description will be saved as custom labor.</p>}</div>}</label>;
}
