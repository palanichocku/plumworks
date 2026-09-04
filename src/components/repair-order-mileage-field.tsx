"use client";

import { useActionState } from "react";
import { updateRepairOrderMileage, type RepairOrderSaveState } from "@/app/(app)/repair-orders/actions";

const initialState: RepairOrderSaveState = { status: "idle" };

export function RepairOrderMileageField({ repairOrderId, mileage }: { repairOrderId: string; mileage: number | null }) {
  const [state, action, pending] = useActionState(updateRepairOrderMileage, initialState);
  return <form action={action} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <input type="hidden" name="repairOrderId" value={repairOrderId} />
    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Current mileage
      <span className="mt-1 flex flex-wrap gap-2"><input name="mileage" type="number" min="1" max="10000000" defaultValue={mileage ?? ""} placeholder="Enter current mileage" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10" /><button disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></span>
    </label>
    <p className="mt-2 text-xs text-slate-500">Enter the vehicle&apos;s current odometer reading. Leave it blank and save to clear it.</p>
    {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-2 text-xs font-semibold ${state.status === "error" ? "text-red-700" : "text-emerald-700"}`}>{state.message}</p> : null}
  </form>;
}
