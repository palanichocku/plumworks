"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { searchHistoricalDescriptions } from "@/app/(app)/repair-orders/description-history-actions";
import { DictationButton } from "@/components/dictation-button";
import { HISTORICAL_DESCRIPTION_MIN_CHARS, normalizeHistoricalDescription, type HistoricalDescriptionKind, type HistoricalDescriptionSuggestion } from "@/lib/historical-descriptions";

const DEBOUNCE_MS = 275;
const MAX_DESCRIPTION_LENGTH = 500;

type PopoverPosition = { top: number; left: number; width: number };

function getPopoverPosition(anchor: HTMLElement): PopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const gutter = 16;
  const width = Math.min(560, window.innerWidth - gutter * 2);
  const left = Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter));
  return { top: Math.min(rect.bottom + 8, window.innerHeight - 220), left, width };
}

function PopoverShell({ anchor, children, onDismiss }: { anchor: HTMLElement; children: React.ReactNode; onDismiss: () => void }) {
  const [position, setPosition] = useState<PopoverPosition>(() => getPopoverPosition(anchor));

  useEffect(() => {
    const reposition = () => setPosition(getPopoverPosition(anchor));
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor]);

  const style: CSSProperties = { top: position.top, left: position.left, width: position.width };
  return createPortal(
    <div className="fixed inset-0 z-[90]" onMouseDown={onDismiss}>
      <div role="dialog" aria-modal="false" className="fixed max-h-[72vh] overflow-auto rounded-xl border border-slate-300 bg-white p-4 shadow-2xl" style={style} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ReadOnlyDescriptionPreview({ value }: { value: string }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const normalized = value.replace(/\s+/g, " ").trim();

  return <div className="relative min-w-0">
    <button
      ref={anchorRef}
      type="button"
      onClick={() => setOpen(true)}
      title="View full description"
      className="block w-full min-w-0 text-left font-medium text-slate-900 hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25 rounded-md"
    >
      <span className="line-clamp-2 break-words leading-5">{normalized}</span>
      {normalized.length > 90 || value.includes("\n") ? <span className="mt-0.5 block text-[11px] font-semibold text-brand-primary">View full</span> : null}
    </button>
    {open && anchorRef.current ? <PopoverShell anchor={anchorRef.current} onDismiss={() => setOpen(false)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">Description</h3>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">Close</button>
      </div>
      <div className="mt-3 max-h-[52vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800">{value}</div>
    </PopoverShell> : null}
  </div>;
}

export function HistoricalDescriptionCombobox({ kind, value, onChange, label = "Description", placeholder, inputClass, rowKey, multiline = false, autoGrow: _autoGrow = multiline, allowDictation = multiline }: { kind: HistoricalDescriptionKind; value: string; onChange: (value: string) => void; label?: string; placeholder?: string; inputClass: string; rowKey: string; multiline?: boolean; autoGrow?: boolean; allowDictation?: boolean }) {
  const inputId = useId();
  const listboxId = useId();
  const anchorRef = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [results, setResults] = useState<HistoricalDescriptionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [active, setActive] = useState(-1);
  const sequence = useRef(0);
  const queryValue = multiline ? draft : value;
  const query = normalizeHistoricalDescription(queryValue);
  const eligible = query.length >= HISTORICAL_DESCRIPTION_MIN_CHARS;

  useEffect(() => {
    if (!open || !eligible) return;
    const request = ++sequence.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const matches = await searchHistoricalDescriptions(kind, query);
        if (request === sequence.current) { setResults(matches); setActive(-1); }
      } catch {
        if (request === sequence.current) { setError(true); setResults([]); }
      } finally {
        if (request === sequence.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); sequence.current += 1; };
  }, [eligible, kind, open, query, rowKey]);

  useEffect(() => {
    if (!open || !multiline) return;
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.scrollTop = 0;
      textareaRef.current.setSelectionRange(0, 0);
    });
  }, [multiline, open]);

  function openEditor() {
    setDraft(value);
    setResults([]);
    setError(false);
    setOpen(true);
  }

  function cancelEditor() {
    setDraft(value);
    setOpen(false);
    setActive(-1);
  }

  function doneEditor() {
    onChange(draft);
    setOpen(false);
    setActive(-1);
  }

  function choose(description: string) {
    if (multiline) setDraft(description);
    else onChange(description);
    if (!multiline) setOpen(false);
    setActive(-1);
  }

  function handleEditorKeys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditor();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      doneEditor();
    }
  }

  if (multiline) {
    const preview = value.replace(/\s+/g, " ").trim();
    return <div className="relative z-20 block min-w-0 text-sm font-semibold text-slate-800 focus-within:z-40">
      <div className="mb-1 flex min-h-7 items-center justify-between gap-2"><span>{label}</span><span className="text-[11px] font-medium text-slate-400">Click to expand</span></div>
      <input type="hidden" name="description" value={value} />
      <button
        ref={anchorRef as React.RefObject<HTMLButtonElement>}
        type="button"
        onClick={openEditor}
        className={`${inputClass} flex min-h-[42px] max-h-[42px] items-center text-left font-normal`}
        aria-haspopup="dialog"
      >
        <span className={`line-clamp-2 break-words leading-5 ${preview ? "text-slate-950" : "text-slate-400"}`}>{preview || placeholder || "Enter description"}</span>
      </button>
      {open && anchorRef.current ? <PopoverShell anchor={anchorRef.current} onDismiss={cancelEditor}>
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-bold text-slate-900">{label}</h3><p className="mt-0.5 text-xs text-slate-500">Edit the full description. Esc cancels; Cmd/Ctrl+Enter accepts.</p></div>
          {allowDictation ? <DictationButton textareaId={inputId} value={draft} onChange={setDraft} /> : null}
        </div>
        <textarea
          ref={textareaRef}
          id={inputId}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setActive(-1); }}
          onKeyDown={handleEditorKeys}
          rows={9}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder={placeholder}
          className="mt-3 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10"
        />
        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500"><span>{draft.length}/{MAX_DESCRIPTION_LENGTH}</span><span>Changes are not applied until Done.</span></div>
        <div id={listboxId} className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
          {!eligible ? <p className="px-3 py-2 text-xs text-slate-500">Type at least 2 characters to see previous descriptions.</p>
            : loading ? <p className="px-3 py-2 text-xs text-slate-500">Searching previous descriptions…</p>
            : error ? <p className="px-3 py-2 text-xs text-slate-500">Previous descriptions are unavailable. You can still use the text above.</p>
            : results.length ? results.map((result, index) => <button key={normalizeHistoricalDescription(result.description)} type="button" onClick={() => choose(result.description)} onMouseEnter={() => setActive(index)} className={`block w-full whitespace-pre-wrap break-words rounded-md px-3 py-2 text-left text-xs ${active === index ? "bg-white text-brand-primary" : "text-slate-700 hover:bg-white"}`}>{result.description}</button>)
            : <p className="px-3 py-2 text-xs text-slate-500">No previous descriptions found.</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={cancelEditor} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={doneEditor} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white">Done</button>
        </div>
      </PopoverShell> : null}
    </div>;
  }

  return <label className="relative z-20 block min-w-0 text-sm font-semibold text-slate-800 focus-within:z-40">
    <span className="mb-1 block min-h-7">{label}</span>
    <input
      ref={anchorRef as React.RefObject<HTMLInputElement>}
      name="description"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listboxId}
      autoComplete="off"
      required
      maxLength={MAX_DESCRIPTION_LENGTH}
      value={value}
      placeholder={placeholder}
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => setOpen(false), 100)}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      className={inputClass}
    />
    {open ? <div id={listboxId} role="listbox" aria-label="Previous descriptions" className="absolute left-0 z-50 mt-1 max-h-56 w-full min-w-0 overflow-y-auto rounded-lg border border-slate-300 bg-white p-1 font-normal shadow-lg">
      {!eligible ? <p className="px-3 py-2 text-sm text-slate-600">Type at least 2 characters</p>
        : loading ? <p className="px-3 py-2 text-sm text-slate-600">Searching previous descriptions…</p>
        : error ? <p className="px-3 py-2 text-sm text-slate-600">Previous descriptions are unavailable. Continue typing to use a new description.</p>
        : results.length ? results.map((result, index) => <button key={normalizeHistoricalDescription(result.description)} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(result.description)} className="block w-full whitespace-pre-wrap break-words rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">{result.description}</button>)
        : <p className="px-3 py-2 text-sm text-slate-600">No previous descriptions found</p>}
    </div> : null}
  </label>;
}
