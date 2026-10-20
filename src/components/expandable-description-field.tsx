"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { DictationButton } from "@/components/dictation-button";

const MAX_DESCRIPTION_LENGTH = 500;

type PopoverPosition = { top: number; left: number; width: number; height: number };

function getPopoverPosition(anchor: HTMLElement, preferredHeight: number): PopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const gutter = 16;
  const gap = 8;
  const width = Math.min(560, window.innerWidth - gutter * 2);
  const height = Math.min(preferredHeight, window.innerHeight - gutter * 2);
  const left = Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter));
  const spaceBelow = window.innerHeight - rect.bottom - gutter;
  const spaceAbove = rect.top - gutter;
  const openAbove = spaceBelow < Math.min(height, 420) && spaceAbove > spaceBelow;
  const top = openAbove
    ? Math.max(gutter, rect.top - gap - height)
    : Math.max(gutter, Math.min(rect.bottom + gap, window.innerHeight - gutter - height));
  return { top, left, width, height };
}

function PopoverShell({ anchor, children, onDismiss, preferredHeight = 440 }: { anchor: HTMLElement; children: React.ReactNode; onDismiss: () => void; preferredHeight?: number }) {
  const [position, setPosition] = useState<PopoverPosition>(() => getPopoverPosition(anchor, preferredHeight));

  useEffect(() => {
    const reposition = () => setPosition(getPopoverPosition(anchor, preferredHeight));
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor, preferredHeight]);

  const style: CSSProperties = { top: position.top, left: position.left, width: position.width, height: position.height };
  return createPortal(
    <div className="fixed inset-0 z-[90]" onMouseDown={onDismiss}>
      <div role="dialog" aria-modal="false" className="fixed overflow-hidden rounded-xl border border-slate-300 bg-white p-4 shadow-2xl" style={style} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ExpandableDescriptionField({
  name = "description",
  label = "Description",
  defaultValue = "",
  placeholder,
  inputClass,
}: {
  name?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  inputClass: string;
}) {
  const textareaId = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(defaultValue);
  const [draft, setDraft] = useState(defaultValue);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.scrollTop = 0;
      textareaRef.current.setSelectionRange(0, 0);
    });
  }, [open]);

  function openEditor() {
    setDraft(value);
    setOpen(true);
  }

  function cancelEditor() {
    setDraft(value);
    setOpen(false);
  }

  function doneEditor() {
    setValue(draft);
    setOpen(false);
  }

  function handleKeys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditor();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      doneEditor();
    }
  }

  const preview = value.replace(/\s+/g, " ").trim();

  return <div className="relative min-w-0">
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-[11px] font-medium normal-case tracking-normal text-slate-400">Click to expand</span>
    </div>
    <input type="hidden" name={name} value={value} />
    <button
      ref={anchorRef}
      type="button"
      onClick={openEditor}
      className={`${inputClass} mt-0 flex min-h-[38px] max-h-[38px] items-center text-left`}
      aria-haspopup="dialog"
    >
      <span className={`line-clamp-1 break-words ${preview ? "text-slate-900" : "text-slate-400"}`}>{preview || placeholder || "Enter description"}</span>
    </button>
    {open && anchorRef.current ? <PopoverShell anchor={anchorRef.current} onDismiss={cancelEditor}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{label}</h3>
            <p className="mt-0.5 text-xs text-slate-500">Edit the full description. Esc cancels; Cmd/Ctrl+Enter accepts.</p>
          </div>
          <DictationButton textareaId={textareaId} value={draft} onChange={setDraft} />
        </div>
        <textarea
          ref={textareaRef}
          id={textareaId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeys}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder={placeholder}
          className="mt-3 min-h-[10rem] flex-1 resize-none overflow-y-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10"
        />
        <div className="mt-1 flex shrink-0 items-center justify-between gap-3 text-xs text-slate-500">
          <span>{draft.length}/{MAX_DESCRIPTION_LENGTH}</span>
          <span>Changes are not applied until Done.</span>
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={cancelEditor} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={doneEditor} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white">Done</button>
        </div>
      </div>
    </PopoverShell> : null}
  </div>;
}
