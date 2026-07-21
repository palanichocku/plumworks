"use client";

import { useActionState, useState } from "react";
import type { InternalNotesState } from "@/app/(app)/internal-notes-actions";

const initialState: InternalNotesState = { status: "idle" };

export function InternalNotesBlock({ recordId, notes, canEdit, emptyMessage, successMessage, action }: { recordId: string; notes: string | null; canEdit: boolean; emptyMessage: string; successMessage: string; action: (state: InternalNotesState, formData: FormData) => Promise<InternalNotesState> }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [dirty, setDirty] = useState(false);

  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-950">Internal Notes</h2>
    <p className="mt-1 text-sm text-slate-500">Visible only to authorized shop users.</p>
    {canEdit ? <form action={formAction} onChange={() => setDirty(true)} onSubmit={() => setDirty(false)} className="mt-5">
      <input type="hidden" name="recordId" value={recordId} />
      <label htmlFor={`internal-notes-${recordId}`} className="sr-only">Internal Notes</label>
      <textarea id={`internal-notes-${recordId}`} name="notes" rows={6} maxLength={5000} defaultValue={notes ?? ""} className="min-h-36 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {!dirty && !pending && state.status === "success" ? <p role="status" aria-live="polite" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><span aria-hidden="true">✓</span> {successMessage}</p> : null}
        {!dirty && !pending && state.status === "error" ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{state.message}</p> : null}
        <button type="submit" disabled={pending} className="ml-auto inline-flex items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Saving…" : "Save Notes"}</button>
      </div>
    </form> : <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{notes || emptyMessage}</p>}
  </section>;
}
