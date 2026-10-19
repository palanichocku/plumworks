"use client";

import { useCallback, useId, useLayoutEffect, useState, useTransition } from "react";
import type { InternalNotesState } from "@/app/(app)/internal-notes-actions";
import { DictationButton } from "@/components/dictation-button";
import { MAX_INTERNAL_NOTES_LENGTH } from "@/lib/internal-notes";

export function InternalNoteEditor({ recordId, notes, label, emptyMessage, successMessage, canEdit, action, contextCustomerId }: {
  recordId: string;
  notes: string | null;
  label: string;
  emptyMessage: string;
  successMessage: string;
  canEdit: boolean;
  action: (state: InternalNotesState, formData: FormData) => Promise<InternalNotesState>;
  contextCustomerId?: string;
}) {
  const textareaId = useId();
  const messageId = useId();
  const [savedNotes, setSavedNotes] = useState(notes);
  const [draft, setDraft] = useState(notes ?? "");
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<InternalNotesState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const resizeTextarea = useCallback(() => {
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!textarea) return;
    textarea.style.height = "auto";
    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
    const chrome = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom) + Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
    const minimum = (lineHeight * 4) + chrome;
    const maximum = (lineHeight * 10) + chrome;
    textarea.style.height = `${Math.max(minimum, Math.min(textarea.scrollHeight, maximum))}px`;
    textarea.style.overflowY = textarea.scrollHeight > maximum ? "auto" : "hidden";
  }, [textareaId]);

  useLayoutEffect(() => {
    if (editing) resizeTextarea();
  }, [draft, editing, resizeTextarea]);

  function cancel() {
    setDraft(savedNotes ?? "");
    setEditing(false);
    setState({ status: "idle" });
  }

  function save() {
    const formData = new FormData();
    formData.set("recordId", recordId);
    formData.set("notes", draft);
    if (contextCustomerId) formData.set("contextCustomerId", contextCustomerId);
    startTransition(async () => {
      try {
        const result = await action({ status: "idle" }, formData);
        setState(result);
        if (result.status !== "success") return;
        const normalized = draft.trim() || null;
        setSavedNotes(normalized);
        setDraft(normalized ?? "");
        setEditing(false);
      } catch {
        setState({ status: "error", message: "The internal note could not be saved. Please try again." });
      }
    });
  }

  const startEditing = () => {
    setEditing(true);
    setState({ status: "idle" });
  };

  return <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
      {canEdit && !editing ? (
        savedNotes ? <button type="button" onClick={startEditing} className="rounded-md px-2 py-1 text-xs font-semibold text-brand-primary hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/30">Edit</button>
          : <button type="button" onClick={startEditing} className="shrink-0 rounded-lg bg-brand-primary px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20">+ Add note</button>
      ) : null}
    </div>
    {editing ? <div className="mt-3">
      <div className="mb-1 flex min-h-7 items-center justify-between gap-2">
        <label htmlFor={textareaId} className="text-xs font-semibold text-slate-600">{label}</label>
        <DictationButton textareaId={textareaId} value={draft} onChange={(next) => { setDraft(next); setState({ status: "idle" }); }} />
      </div>
      <textarea id={textareaId} value={draft} onChange={(event) => { setDraft(event.target.value); setState({ status: "idle" }); }} rows={4} maxLength={MAX_INTERNAL_NOTES_LENGTH} aria-describedby={state.status === "error" ? messageId : undefined} className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10" />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={cancel} disabled={pending} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Saving…" : "Save note"}</button>
      </div>
    </div> : <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{savedNotes || emptyMessage}</p>}
    {!editing && state.status === "success" ? <p role="status" aria-live="polite" className="mt-2 text-xs font-medium text-emerald-700">{successMessage}</p> : null}
    {state.status === "error" ? <p id={messageId} role="alert" className="mt-2 text-xs font-medium text-red-700">{state.message}</p> : null}
  </div>;
}
