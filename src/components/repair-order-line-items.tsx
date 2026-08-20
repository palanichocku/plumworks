"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addLaborLineWithState, deleteLaborLine, updateLaborLineWithState, type LaborActionState } from "@/app/(app)/repair-orders/labor-actions";
import { addComplimentaryServiceWithState, deleteComplimentaryService, updateComplimentaryServiceWithState } from "@/app/(app)/repair-orders/complimentary-service-actions";
import { addPartLineWithState, deletePartLine, updatePartLineWithState } from "@/app/(app)/repair-orders/part-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { addLineItemButtonClass, CheckIcon, ClearLineItemButton, deleteLineItemButtonClass, laborLineItemRowClass, LineItemAmountActions, partLineItemRowClass, PendingIcon, PlusIcon, saveLineItemButtonClass, TrashIcon } from "@/components/line-item-layout";
import { PartActionForm } from "@/components/part-action-form";
import { VendorCombobox, type VendorOption } from "@/components/vendor-combobox";
import { HistoricalDescriptionCombobox } from "@/components/historical-description-combobox";

type PartLine = { id: string; description: string; quantity: string; unitPrice: string; vendor: VendorOption | null };
type LaborLine = { id: string; description: string; hours: string; hourlyRate: string; shopSuppliesEligible: boolean };
type CommonService = { id: string; name: string; description: string; defaultHours: string; defaultLaborRate: string; shopSuppliesEligible: boolean };

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
    <HistoricalDescriptionCombobox kind="part" rowKey={line.id} value={description} onChange={setDescription} inputClass={inputClass} />
    <VendorCombobox vendors={vendors} defaultVendor={line.vendor} onValueChange={() => setVendorChanged(true)} />
    <label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputClass} /></label>
    <label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className={inputClass} /></label>
    <LineItemAmountActions amount={Number(quantity) * Number(unitPrice)}><FormSubmitButton disabled={!dirty} pendingLabel={<PendingIcon />} pendingAriaLabel="Saving part" ariaLabel="Save part" title="Save part" className={saveLineItemButtonClass}><CheckIcon /></FormSubmitButton><SavedDeleteButton action={deletePartLine} label="Delete part" /></LineItemAmountActions>
  </PartActionForm>;
}

function DraftPartRow({ repairOrderId, vendors, onReset }: { repairOrderId: string; vendors: VendorOption[]; onReset: () => void }) {
  const [description, setDescription] = useState(""); const [quantity, setQuantity] = useState("1"); const [unitPrice, setUnitPrice] = useState("");
  return <PartActionForm action={addPartLineWithState} onSuccess={onReset} className={`${partLineItemRowClass} rounded-lg border border-slate-200 bg-slate-50/40 p-3`}>
    <input type="hidden" name="repairOrderId" value={repairOrderId} /><HistoricalDescriptionCombobox kind="part" rowKey="draft-part" value={description} onChange={setDescription} inputClass={inputClass} placeholder="Part description" /><VendorCombobox vendors={vendors} /><label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputClass} /></label><label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className={inputClass} /></label><LineItemAmountActions amount={Number(quantity) * Number(unitPrice)}><FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel="Adding part" ariaLabel="Add part" title="Add part" className={addLineItemButtonClass}><PlusIcon /></FormSubmitButton><ClearLineItemButton label="Clear part" onClear={onReset} /></LineItemAmountActions>
  </PartActionForm>;
}

export function RepairOrderLaborCard({ repairOrderId, total, lines, complimentaryLines, services, defaultRate, editable }: { repairOrderId: string; total: string; lines: LaborLine[]; complimentaryLines: Array<Pick<LaborLine, "id" | "description">>; services: CommonService[]; defaultRate: string; editable: boolean }) {
  const [draftVersion, setDraftVersion] = useState(0); const [complimentaryDraftVersion, setComplimentaryDraftVersion] = useState(0);
  return <fieldset disabled={!editable} className="ro-line-card min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm disabled:bg-slate-50 disabled:opacity-75"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Labor</h2><p className="mt-1 text-sm text-slate-600">Search Common Services or enter a custom description. Amount is hours × rate.</p></div><p className="font-semibold text-slate-950">{money(Number(total))}</p></div>{lines.length > 0 && <div className="space-y-3">{lines.map((line) => <SavedLaborRow key={line.id} repairOrderId={repairOrderId} line={line} services={services} />)}</div>}{editable && <div className="border-t border-slate-200 pt-4"><DraftLaborRow key={draftVersion} repairOrderId={repairOrderId} services={services} defaultRate={defaultRate} onReset={() => setDraftVersion((version) => version + 1)} /></div>}<div className="border-t border-slate-200 pt-5"><h3 className="font-semibold text-slate-950">Complimentary Services</h3><p className="mt-1 text-sm text-slate-600">Record services provided at no charge.</p>{complimentaryLines.length > 0 && <div className="mt-4 space-y-3">{complimentaryLines.map((line) => <SavedComplimentaryRow key={line.id} repairOrderId={repairOrderId} line={line} services={services} />)}</div>}{editable && <div className="mt-4"><DraftComplimentaryRow key={complimentaryDraftVersion} repairOrderId={repairOrderId} services={services} onReset={() => setComplimentaryDraftVersion((version) => version + 1)} /></div>}</div></fieldset>;
}

function LaborActionForm({ action, children, onSuccess }: { action: (state: LaborActionState, formData: FormData) => Promise<LaborActionState>; children: React.ReactNode; onSuccess?: () => void }) {
  const [state, formAction] = useActionState(action, { status: "idle" } as LaborActionState);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { if (state.status === "success") onSuccessRef.current?.(); }, [state]);
  return <form action={formAction} className={`${laborLineItemRowClass} rounded-lg border border-slate-200 p-3`}>{children}<div aria-live="polite" className="sm:col-span-full">{state.status === "error" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{state.message}</p>}{state.status === "success" && <p className="text-sm font-medium text-emerald-700">Saved.</p>}</div></form>;
}

function SavedLaborRow({ repairOrderId, line, services }: { repairOrderId: string; line: LaborLine; services: CommonService[] }) {
  const [description, setDescription] = useState(line.description); const [hours, setHours] = useState(line.hours); const [rate, setRate] = useState(line.hourlyRate); const [eligible, setEligible] = useState(line.shopSuppliesEligible); const [saved, setSaved] = useState(line);
  const dirty = description !== saved.description || hours !== saved.hours || rate !== saved.hourlyRate || eligible !== saved.shopSuppliesEligible;
  return <LaborActionForm action={updateLaborLineWithState} onSuccess={() => setSaved({ ...line, description, hours, hourlyRate: rate, shopSuppliesEligible: eligible })}><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="laborLineId" value={line.id} /><input type="hidden" name="shopSuppliesEligible" value={String(eligible)} /><ServiceCombobox services={services} value={description} onChange={setDescription} onSelect={(service) => { setDescription(service.description); setHours(service.defaultHours); setRate(service.defaultLaborRate); setEligible(service.shopSuppliesEligible); }} /><label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" value={hours} onChange={(event) => setHours(event.target.value)} className={inputClass} /></label><label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} className={inputClass} /></label><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={eligible} onChange={(event) => setEligible(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-primary" />Apply Shop Supplies</label><LineItemAmountActions amount={Number(hours) * Number(rate)}><FormSubmitButton disabled={!dirty} pendingLabel={<PendingIcon />} pendingAriaLabel="Saving labor" ariaLabel="Save labor" title="Save labor" className={saveLineItemButtonClass}><CheckIcon /></FormSubmitButton><SavedDeleteButton action={deleteLaborLine} label="Delete labor" /></LineItemAmountActions></LaborActionForm>;
}

function DraftLaborRow({ repairOrderId, services, defaultRate, onReset }: { repairOrderId: string; services: CommonService[]; defaultRate: string; onReset: () => void }) {
  const [description, setDescription] = useState(""); const [hours, setHours] = useState(""); const [rate, setRate] = useState(defaultRate); const [eligible, setEligible] = useState(true);
  return <LaborActionForm action={addLaborLineWithState} onSuccess={onReset}><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="shopSuppliesEligible" value={String(eligible)} /><ServiceCombobox services={services} value={description} onChange={setDescription} onSelect={(service) => { setDescription(service.description); setHours(service.defaultHours); setRate(service.defaultLaborRate); setEligible(service.shopSuppliesEligible); }} /><label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" value={hours} onChange={(event) => setHours(event.target.value)} className={inputClass} /></label><label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} className={inputClass} /></label><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={eligible} onChange={(event) => setEligible(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-primary" />Apply Shop Supplies</label><LineItemAmountActions amount={Number(hours) * Number(rate)}><FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel="Adding labor" ariaLabel="Add labor" title="Add labor" className={addLineItemButtonClass}><PlusIcon /></FormSubmitButton><ClearLineItemButton label="Clear labor" onClear={onReset} /></LineItemAmountActions></LaborActionForm>;
}

function ComplimentaryActionForm({ action, children, onSuccess }: { action: (state: LaborActionState, formData: FormData) => Promise<LaborActionState>; children: React.ReactNode; onSuccess?: () => void }) {
  const [state, formAction] = useActionState(action, { status: "idle" } as LaborActionState);
  const successRef = useRef(onSuccess); useEffect(() => { successRef.current = onSuccess; }, [onSuccess]); useEffect(() => { if (state.status === "success") successRef.current?.(); }, [state]);
  return <form action={formAction} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-lg border border-slate-200 p-3">{children}<div aria-live="polite" className="col-span-full">{state.status === "error" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{state.message}</p>}{state.status === "success" && <p className="text-sm font-medium text-emerald-700">Saved.</p>}</div></form>;
}

function SavedComplimentaryRow({ repairOrderId, line, services }: { repairOrderId: string; line: Pick<LaborLine, "id" | "description">; services: CommonService[] }) {
  const [description, setDescription] = useState(line.description); const [saved, setSaved] = useState(line.description);
  return <ComplimentaryActionForm action={updateComplimentaryServiceWithState} onSuccess={() => setSaved(description)}><input type="hidden" name="repairOrderId" value={repairOrderId} /><input type="hidden" name="laborLineId" value={line.id} /><ServiceCombobox services={services} value={description} onChange={setDescription} onSelect={(service) => setDescription(service.description)} placeholder="Complimentary service description" /><div className="flex items-center gap-2"><FormSubmitButton disabled={description === saved} pendingLabel={<PendingIcon />} pendingAriaLabel="Saving complimentary service" ariaLabel="Save complimentary service" title="Save complimentary service" className={saveLineItemButtonClass}><CheckIcon /></FormSubmitButton><SavedDeleteButton action={deleteComplimentaryService} label="Delete complimentary service" /></div></ComplimentaryActionForm>;
}

function DraftComplimentaryRow({ repairOrderId, services, onReset }: { repairOrderId: string; services: CommonService[]; onReset: () => void }) {
  const [description, setDescription] = useState("");
  return <ComplimentaryActionForm action={addComplimentaryServiceWithState} onSuccess={onReset}><input type="hidden" name="repairOrderId" value={repairOrderId} /><ServiceCombobox services={services} value={description} onChange={setDescription} onSelect={(service) => setDescription(service.description)} placeholder="Complimentary service description" /><div className="flex items-center gap-2"><FormSubmitButton pendingLabel={<PendingIcon />} pendingAriaLabel="Adding complimentary service" ariaLabel="Add complimentary service" title="Add complimentary service" className={addLineItemButtonClass}><PlusIcon /></FormSubmitButton><ClearLineItemButton label="Clear complimentary service" onClear={() => setDescription("")} /></div></ComplimentaryActionForm>;
}

function ServiceCombobox({ services, value, onChange, onSelect, placeholder = "Search services or enter labor", complimentary = placeholder.startsWith("Complimentary"), rowKey = "draft-labor" }: { services: CommonService[]; value: string; onChange: (value: string) => void; onSelect: (service: CommonService) => void; placeholder?: string; complimentary?: boolean; rowKey?: string }) {
  return <div className="min-w-0"><HistoricalDescriptionCombobox kind={complimentary ? "complimentary-labor" : "labor"} rowKey={rowKey} value={value} onChange={onChange} label="Service / description" placeholder={placeholder} inputClass={inputClass} />{services.length ? <label className="mt-1.5 block text-xs font-medium text-slate-500">Common Service<select aria-label="Common Services" defaultValue="" onChange={(event) => { const service = services.find((item) => item.id === event.target.value); if (service) onSelect(service); event.target.value = ""; }} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"><option value="">Choose a Common Service…</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label> : null}</div>;
}
