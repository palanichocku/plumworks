"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildVendorChoices,
  MAX_VENDOR_NAME_LENGTH,
  resolveVendorSubmission,
} from "@/lib/vendors";

export type VendorOption = { id: string; name: string };

export function VendorCombobox({ vendors, defaultVendor = null, onValueChange }: {
  vendors: VendorOption[];
  defaultVendor?: VendorOption | null;
  onValueChange?: (value: { vendorId: string; newVendorName: string; input: string }) => void;
}) {
  const inputId = useId();
  const listId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultVendor?.name ?? "");
  const [vendorId, setVendorId] = useState(defaultVendor?.id ?? "");
  const [newVendorName, setNewVendorName] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const vendorIdInputRef = useRef<HTMLInputElement>(null);
  const newVendorNameInputRef = useRef<HTMLInputElement>(null);
  const vendorInputRef = useRef<HTMLInputElement>(null);
  const { cleanedQuery, choices } = useMemo(
    () => buildVendorChoices(vendors, query),
    [query, vendors],
  );
  const optionCount = choices.length;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const form = input.form;
    if (!form) return;

    function resolveSubmittedVendor() {
      const resolved = resolveVendorSubmission(vendors, inputRef.current?.value ?? "");
      if (vendorIdInputRef.current) vendorIdInputRef.current.value = resolved.vendorId;
      if (newVendorNameInputRef.current) newVendorNameInputRef.current.value = resolved.newVendorName;
      if (vendorInputRef.current) vendorInputRef.current.value = resolved.vendorInput;
    }

    form.addEventListener("submit", resolveSubmittedVendor, true);
    return () => form.removeEventListener("submit", resolveSubmittedVendor, true);
  }, [vendors]);

  function chooseExisting(vendor: VendorOption) {
    setVendorId(vendor.id);
    setNewVendorName("");
    setQuery(vendor.name);
    onValueChange?.({ vendorId: vendor.id, newVendorName: "", input: vendor.name });
    setOpen(false);
  }

  function chooseNew() {
    setVendorId("");
    setNewVendorName(cleanedQuery);
    setQuery(cleanedQuery);
    onValueChange?.({ vendorId: "", newVendorName: cleanedQuery, input: cleanedQuery });
    setOpen(false);
  }

  function chooseActive() {
    const choice = choices[activeIndex];
    if (choice?.type === "new") chooseNew();
    else if (choice?.type === "existing") chooseExisting(choice.vendor);
  }

  return <label htmlFor={inputId} className="relative z-30 min-w-0 text-sm font-semibold text-slate-700 focus-within:z-40">
    Vendor <span className="font-normal text-slate-500">(optional)</span>
    <input ref={vendorIdInputRef} type="hidden" name="vendorId" value={vendorId} />
    <input ref={newVendorNameInputRef} type="hidden" name="newVendorName" value={newVendorName} />
    <input ref={vendorInputRef} type="hidden" name="vendorInput" value={query} />
    <input
      ref={inputRef}
      id={inputId}
      type="text"
      role="combobox"
      aria-autocomplete="list"
      aria-controls={listId}
      aria-expanded={open}
      aria-activedescendant={open && optionCount ? `${inputId}-option-${activeIndex}` : undefined}
      autoComplete="off"
      maxLength={MAX_VENDOR_NAME_LENGTH + 1}
      value={query}
      placeholder="Search or add vendor"
      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/10"
      onFocus={() => { setOpen(true); setActiveIndex(0); }}
      onChange={(event) => {
        const nextQuery = event.target.value;
        const nextExactVendor = buildVendorChoices(vendors, nextQuery).exactVendor;
        setQuery(nextQuery);
        setVendorId(nextExactVendor?.id ?? "");
        setNewVendorName("");
        onValueChange?.({ vendorId: nextExactVendor?.id ?? "", newVendorName: "", input: nextQuery });
        setOpen(true);
        setActiveIndex(0);
      }}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setOpen(true);
          setActiveIndex((index) => optionCount ? (index + 1) % optionCount : 0);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          setActiveIndex((index) => optionCount ? (index - 1 + optionCount) % optionCount : 0);
        } else if (event.key === "Enter" && open && optionCount) {
          event.preventDefault();
          chooseActive();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
        }
      }}
    />
    {open && <div id={listId} role="listbox" aria-label="Vendors" className="absolute left-0 z-50 mt-1 max-h-56 w-max min-w-full max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 font-normal shadow-lg">
      {choices.map((choice, index) => choice.type === "new" ? <button
        key={`new:${choice.name}`}
        id={`${inputId}-option-${index}`}
        type="button"
        role="option"
        aria-selected={activeIndex === index}
        className={`block w-full break-words rounded-md px-3 py-2 text-left text-sm font-medium ${activeIndex === index ? "bg-brand-subtle text-brand-primary" : "text-slate-700 hover:bg-slate-50"}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={chooseNew}
      >Add “{choice.name}”</button> : <button
        key={choice.vendor.id}
        id={`${inputId}-option-${index}`}
        type="button"
        role="option"
        aria-selected={activeIndex === index}
        className={`block w-full break-words rounded-md px-3 py-2 text-left text-sm ${activeIndex === index ? "bg-brand-subtle text-brand-primary" : "text-slate-700 hover:bg-slate-50"}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => chooseExisting(choice.vendor)}
      >{choice.vendor.name}</button>)}
      {!optionCount && <p className="px-3 py-2 text-sm text-slate-500">No vendors found. Type a name to add one.</p>}
      {cleanedQuery.length > MAX_VENDOR_NAME_LENGTH && <p role="alert" className="px-3 py-2 text-sm text-red-700">Vendor name must be {MAX_VENDOR_NAME_LENGTH} characters or fewer.</p>}
    </div>}
  </label>;
}
