"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidRepairOrder } from "@/app/(app)/repair-orders/void-actions";
import { REPAIR_ORDER_VOID_REASON_OPTIONS, type VoidRepairOrderState } from "@/lib/repair-order-void";

const initial: VoidRepairOrderState = { status: "idle" };

export function VoidRepairOrderButton({ repairOrderId, repairOrderNumber, compact = false }: {
  repairOrderId: string;
  repairOrderNumber: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<VoidRepairOrderState>(initial);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);

  function submit(formData: FormData) {
    if (submitting.current) return;
    submitting.current = true;
    startTransition(async () => {
      const result = await voidRepairOrder(initial, formData);
      setState(result);
      submitting.current = false;
      if (result.status === "success") {
        setOpen(false);
        router.refresh();
      }
    });
  }

  function showDialog() {
    setReason("");
    setState(initial);
    setOpen(true);
  }

  return <>
    <button type="button" onClick={showDialog} className={compact
      ? "inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-700 hover:text-white focus:outline-none focus:ring-4 focus:ring-red-100"
      : "rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-700 hover:text-white focus:outline-none focus:ring-4 focus:ring-red-100"}>
      Void
    </button>
    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4 whitespace-normal">
      <button type="button" aria-label="Cancel void" disabled={pending} onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/50" />
      <section role="alertdialog" aria-modal="true" aria-labelledby="void-ro-title" className="relative w-full min-w-0 max-w-lg whitespace-normal rounded-2xl bg-white p-6 text-left shadow-2xl">
        <h2 id="void-ro-title" className="text-xl font-bold text-slate-950">Void RO #{repairOrderNumber}?</h2>
        <div className="mt-3 w-full min-w-0 max-w-full space-y-2 whitespace-normal break-words rounded-lg bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <p className="min-w-0 whitespace-normal break-words">This repair order will remain in the system for audit history. RO #{repairOrderNumber} will not be reused.</p>
        </div>
        <form action={submit} className="mt-5">
          <input type="hidden" name="repairOrderId" value={repairOrderId} />
          <div className="w-full min-w-0 space-y-4">
            <label className="block w-full min-w-0 text-sm font-semibold text-slate-800">
              <span className="block">Reason</span>
              <select name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 block w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
                <option value="">Select a reason</option>
                {REPAIR_ORDER_VOID_REASON_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {reason === "OTHER" ? <label className="block w-full min-w-0 text-sm font-semibold text-slate-800">
              <span className="block">Please explain</span>
              <textarea name="note" required minLength={3} maxLength={500} rows={3} className="mt-1.5 block w-full min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label> : null}
            {state.status === "error" ? <p role="alert" className="text-sm font-medium text-red-700">{state.message}</p> : null}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Voiding…" : "Void RO"}</button>
          </div>
        </form>
      </section>
    </div> : null}
  </>;
}
