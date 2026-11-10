"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyOutTheDoorPricing, previewOutTheDoorPricing, type OutTheDoorPreview } from "@/app/(app)/repair-orders/out-the-door-actions";

const usd = (v: string) => Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
export function OutTheDoorPricing({ repairOrderId }: { repairOrderId: string }) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState("");
  const [labor, setLabor] = useState("");
  const [preview, setPreview] = useState<OutTheDoorPreview | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const change = (setter: (v: string) => void, v: string) => { setter(v); setPreview(null); setError(""); };
  return <div className="mt-4 border-t border-slate-200 pt-4">
    <button type="button" onClick={() => setOpen(!open)} className="min-h-10 rounded-lg border border-brand-primary px-3 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-subtle" aria-expanded={open}>
      Out-the-Door Pricing {open ? "−" : "+"}
    </button>
    {open && <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-600">Enter the price promised to the customer. Parts includes tax; labor includes shop supplies and any applicable tax. Supports one part and one paid labor line, each with quantity/hours of 1.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Parts including tax
          <input type="number" min="0" max="10000" step="0.01" inputMode="decimal" value={parts} onChange={e => change(setParts, e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950" placeholder="225.00" />
        </label>
        <label className="text-sm font-semibold text-slate-700">Labor including supplies
          <input type="number" min="0" max="10000" step="0.01" inputMode="decimal" value={labor} onChange={e => change(setLabor, e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950" placeholder="55.00" />
        </label>
      </div>
      {parts !== "" && labor !== "" && <p className="font-bold text-slate-900">Quoted out-the-door total: {usd(String(Number(parts) + Number(labor)))}</p>}
      <button type="button" disabled={pending || !parts || !labor} onClick={() => startTransition(async () => {
        setError(""); setPreview(null);
        const result = await previewOutTheDoorPricing(repairOrderId, parts, labor);
        if (result.ok) setPreview(result.preview); else setError(result.message);
      })} className="min-h-10 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Calculating…" : "Calculate & Review"}
      </button>
      {preview && <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-3 text-sm">
        <p className="font-bold text-slate-900">Review before applying</p>
        <dl className="space-y-1">
          <div className="flex justify-between"><dt>Part unit price</dt><dd>{usd(preview.partsUnitPrice)}</dd></div>
          <div className="flex justify-between"><dt>Labor hourly rate</dt><dd>{usd(preview.laborHourlyRate)}</dd></div>
          <div className="flex justify-between"><dt>Shop supplies</dt><dd>{usd(preview.shopSupplies)}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{usd(preview.tax)}</dd></div>
          <div className="flex justify-between border-t pt-2 font-bold"><dt>Final estimate</dt><dd>{usd(preview.total)}</dd></div>
        </dl>
        <p className="text-xs text-amber-800">Applying changes the existing part price and labor rate. Review customer authorization again if the estimate was previously authorized.</p>
        <button type="button" disabled={pending} onClick={() => startTransition(async () => {
          const result = await applyOutTheDoorPricing(repairOrderId, parts, labor, preview);
          if (!result.ok) { setError(result.message); setPreview(null); return; }
          setPreview(null); setOpen(false); setParts(""); setLabor(""); router.refresh();
        })} className="min-h-10 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Applying…" : "Apply to RO"}
        </button>
      </div>}
      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
    </div>}
  </div>;
}
