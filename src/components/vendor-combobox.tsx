"use client";

import { useId, useMemo, useState } from "react";
import { cleanVendorName, MAX_VENDOR_NAME_LENGTH, normalizeVendorName } from "@/lib/vendors";

export type VendorOption = { id: string; name: string };

export function VendorCombobox({ vendors, defaultVendor = null }: {
  vendors: VendorOption[];
  defaultVendor?: VendorOption | null;
}) {
  const inputId = useId();
  const listId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultVendor?.name ?? "");
  const [vendorId, setVendorId] = useState(defaultVendor?.id ?? "");
  const [newVendorName, setNewVendorName] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const cleanedQuery = cleanVendorName(query);
  const normalizedQuery = normalizeVendorName(query);
  const filtered = useMemo(() => vendors.filter((vendor) =>
    normalizeVendorName(vendor.name).includes(normalizedQuery)
  ), [normalizedQuery, vendors]);
  const exactMatch = vendors.some((vendor) => normalizeVendorName(vendor.name) === normalizedQuery);
  const canAdd = Boolean(cleanedQuery) && !exactMatch && cleanedQuery.length <= MAX_VENDOR_NAME_LENGTH;
  const optionCount = filtered.length + (canAdd ? 1 : 0);

  function chooseExisting(vendor: VendorOption) {
    setVendorId(vendor.id);
    setNewVendorName("");
    setQuery(vendor.name);
    setOpen(false);
  }

  function chooseNew() {
    setVendorId("");
    setNewVendorName(cleanedQuery);
    setQuery(cleanedQuery);
    setOpen(false);
  }

  function chooseActive() {
    if (activeIndex < filtered.length) chooseExisting(filtered[activeIndex]);
    else if (canAdd) chooseNew();
  }

  return <label htmlFor={inputId} className="relative text-sm font-semibold text-slate-700">
    Vendor <span className="font-normal text-slate-500">(optional)</span>
    <input type="hidden" name="vendorId" value={vendorId} />
    <input type="hidden" name="newVendorName" value={newVendorName} />
    <input type="hidden" name="vendorInput" value={query} />
    <input
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
        setQuery(event.target.value);
        setVendorId("");
        setNewVendorName("");
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
    {open && <div id={listId} role="listbox" aria-label="Vendors" className="absolute z-20 mt-1 max-h-56 w-full min-w-48 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 font-normal shadow-lg">
      {filtered.map((vendor, index) => <button
        key={vendor.id}
        id={`${inputId}-option-${index}`}
        type="button"
        role="option"
        aria-selected={activeIndex === index}
        className={`block w-full rounded-md px-3 py-2 text-left text-sm ${activeIndex === index ? "bg-brand-subtle text-brand-primary" : "text-slate-700 hover:bg-slate-50"}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => chooseExisting(vendor)}
      >{vendor.name}</button>)}
      {canAdd && <button
        id={`${inputId}-option-${filtered.length}`}
        type="button"
        role="option"
        aria-selected={activeIndex === filtered.length}
        className={`block w-full rounded-md px-3 py-2 text-left text-sm font-medium ${activeIndex === filtered.length ? "bg-brand-subtle text-brand-primary" : "text-slate-700 hover:bg-slate-50"}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(filtered.length)}
        onClick={chooseNew}
      >Add “{cleanedQuery}”</button>}
      {!optionCount && <p className="px-3 py-2 text-sm text-slate-500">No vendors found. Type a name to add one.</p>}
      {cleanedQuery.length > MAX_VENDOR_NAME_LENGTH && <p role="alert" className="px-3 py-2 text-sm text-red-700">Vendor name must be {MAX_VENDOR_NAME_LENGTH} characters or fewer.</p>}
    </div>}
  </label>;
}
