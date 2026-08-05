import { InternalNoteEditor } from "@/components/internal-note-editor";
import type { InternalNotesState } from "@/app/(app)/internal-notes-actions";

export function InternalNotesBlock({ recordId, notes, canEdit, emptyMessage, successMessage, action }: { recordId: string; notes: string | null; canEdit: boolean; emptyMessage: string; successMessage: string; action: (state: InternalNotesState, formData: FormData) => Promise<InternalNotesState> }) {
  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-950">Internal Notes</h2>
    <p className="mt-1 text-sm font-medium text-slate-500">Internal only — not shown to customers.</p>
    <div className="mt-5"><InternalNoteEditor recordId={recordId} notes={notes} label="Note" emptyMessage={emptyMessage} successMessage={successMessage} canEdit={canEdit} action={action} /></div>
  </section>;
}
