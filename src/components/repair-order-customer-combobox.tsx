"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  searchRepairOrderCustomers,
  type RepairOrderCustomerSearchResult,
} from "@/app/(app)/repair-orders/customer-search-actions";
import { normalizeRepairOrderCustomerQuery } from "@/lib/repair-order-customer-search";

const SEARCH_DEBOUNCE_MS = 300;

export function RepairOrderCustomerCombobox({
  selected,
  onSelect,
  inputClass,
  labelClass,
}: {
  selected: RepairOrderCustomerSearchResult | null;
  onSelect: (customer: RepairOrderCustomerSearchResult | null) => void;
  inputClass: string;
  labelClass: string;
}) {
  const inputId = useId();
  const listboxId = useId();
  const [query, setQuery] = useState(selected?.displayName ?? "");
  const [results, setResults] = useState<RepairOrderCustomerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestSequence = useRef(0);
  const cache = useRef(new Map<string, RepairOrderCustomerSearchResult[]>());
  const normalizedQuery = normalizeRepairOrderCustomerQuery(query);
  const searchingSelectedCustomer = Boolean(selected && normalizedQuery === normalizeRepairOrderCustomerQuery(selected.displayName));

  useEffect(() => {
    if (!normalizedQuery || searchingSelectedCustomer) return;
    const normalizedKey = normalizedQuery.toLocaleLowerCase("en-US");
    const sequence = ++requestSequence.current;
    const timeout = window.setTimeout(async () => {
      try {
        const matches = cache.current.get(normalizedKey) ?? await searchRepairOrderCustomers(normalizedQuery);
        if (sequence !== requestSequence.current) return;
        cache.current.set(normalizedKey, matches);
        setResults(matches);
        setOpen(true);
        setActiveIndex(-1);
      } catch {
        if (sequence !== requestSequence.current) return;
        setError(true);
        setResults([]);
        setOpen(true);
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
      requestSequence.current += 1;
    };
  }, [normalizedQuery, searchingSelectedCustomer]);

  function choose(customer: RepairOrderCustomerSearchResult) {
    onSelect(customer);
    setQuery(customer.displayName);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setError(false);
  }

  function clearSelection() {
    onSelect(null);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setError(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => index < results.length - 1 ? index + 1 : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => index > 0 ? index - 1 : results.length - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  }

  const showPanel = open && !searchingSelectedCustomer;
  return <div className="relative animate-fadeIn">
    <label className={labelClass} htmlFor={inputId}>Select Profile</label>
    <div className="relative">
      <input
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${results[activeIndex]?.id}` : undefined}
        value={query}
        placeholder="Start typing to find an existing customer"
        onFocus={() => { if (normalizedQuery && !searchingSelectedCustomer) setOpen(true); }}
        onChange={(event) => {
          if (selected) onSelect(null);
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setResults([]);
          setLoading(Boolean(normalizeRepairOrderCustomerQuery(nextQuery)));
          setError(false);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={`${inputClass} pr-16`}
      />
      {selected ? <button type="button" onClick={clearSelection} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/30" aria-label="Clear selected customer">Clear</button> : null}
    </div>
    <input type="hidden" name="customerId" value={selected?.id ?? ""} />
    {showPanel ? <div id={listboxId} role="listbox" aria-label="Customer search results" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
      {loading ? <p role="status" className="px-4 py-3 text-sm text-slate-500">Loading customers…</p> : null}
      {!loading && error ? <p role="alert" className="px-4 py-3 text-sm text-red-700">Customer search is unavailable. Please try again.</p> : null}
      {!loading && !error && results.length === 0 ? <p role="status" className="px-4 py-3 text-sm text-slate-500">No matching customers found.</p> : null}
      {!loading && !error ? results.map((customer, index) => <button
        key={customer.id}
        id={`${listboxId}-${customer.id}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => choose(customer)}
        className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-brand-subtle focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-primary/30 ${index === activeIndex ? "bg-brand-subtle" : "bg-white"}`}
      >
        <span className="block text-sm font-semibold text-slate-900">{customer.displayName}</span>
        {(customer.phone || customer.email) ? <span className="mt-0.5 block truncate text-xs text-slate-500">{[customer.phone, customer.email].filter(Boolean).join(" · ")}</span> : null}
      </button>) : null}
    </div> : null}
    {!normalizedQuery && !selected ? <p className="mt-1.5 text-xs text-slate-500">Start typing to find an existing customer.</p> : null}
  </div>;
}
