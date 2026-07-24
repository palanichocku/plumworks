"use client";

import { useMemo, useState } from "react";
import { calculateShopSuppliesFromPercentage } from "@/lib/shop-supplies";

const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-2xs outline-none transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10";
const money = (value: { toFixed(digits: number): string }) => `$${value.toFixed(2)}`;

export function ShopSuppliesSettings({ enabled, ratePercent, maximumCharge }: { enabled: boolean; ratePercent: string; maximumCharge: string }) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [rate, setRate] = useState(ratePercent);
  const [cap, setCap] = useState(maximumCharge);
  const [labor, setLabor] = useState("120.00");
  const preview = useMemo(() => {
    try {
      return calculateShopSuppliesFromPercentage({ enabled: isEnabled, laborSubtotal: labor || "0", ratePercent: rate || "0", maximumCap: cap || "0" });
    } catch {
      return null;
    }
  }, [cap, isEnabled, labor, rate]);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 p-5" aria-labelledby="shop-supplies-heading">
      <div>
        <h3 id="shop-supplies-heading" className="font-bold text-slate-900">Shop Supplies</h3>
        <p className="mt-1 text-sm text-slate-600">Calculation basis: Labor subtotal</p>
        <p className="mt-1 text-sm text-slate-600">Shop Supplies are included in the taxable amount. Labor is not.</p>
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
        <input name="shopSuppliesEnabled" type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} className="h-4 w-4 rounded-md border-slate-300 text-brand-primary focus:ring-brand-primary" />
        Enable Shop Supplies
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Rate (%)<input name="shopSuppliesRate" type="number" min="0" max="100" step="0.001" required value={rate} onChange={(event) => setRate(event.target.value)} className={inputClass} /></label>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Maximum charge ($)<input name="shopSuppliesCap" type="number" min="0" max="1000000" step="0.01" required value={cap} onChange={(event) => setCap(event.target.value)} className={inputClass} /></label>
      </div>
      <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">Shop Supplies = the lesser of labor subtotal × rate or maximum charge.</p>
        <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-slate-500">Example labor subtotal ($)<input type="number" min="0" max="1000000" step="0.01" value={labor} onChange={(event) => setLabor(event.target.value)} className={inputClass} /></label>
        {preview ? <dl className="mt-4 grid grid-cols-[1fr_auto] gap-2 tabular-nums"><dt>Rate</dt><dd>{rate || "0"}%</dd><dt>Percentage calculation</dt><dd>{money(preview.uncappedAmount)}</dd><dt>Maximum cap</dt><dd>{money(preview.configuredCap)}</dd><dt className="font-semibold text-slate-900">Applied Shop Supplies</dt><dd className="font-semibold text-slate-900">{money(preview.appliedAmount)}</dd><dt>Cap reached</dt><dd>{preview.capApplied ? "Yes" : "No"}</dd></dl> : <p role="alert" className="mt-3 text-red-700">Enter valid nonnegative example and setting values.</p>}
      </div>
    </section>
  );
}
