"use client";

import { useEffect, useState } from "react";

const storageKey = "plumworks:sidebar-collapsed";
const searchEvent = "plumworks:open-sidebar-search";

function applyCollapsed(collapsed: boolean) {
  document.getElementById("app-shell")?.setAttribute("data-sidebar-collapsed", String(collapsed));
  try {
    window.localStorage.setItem(storageKey, String(collapsed));
  } catch {
    // The control still works when browser storage is unavailable.
  }
}

export function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey) === "true";
      setCollapsed(saved);
      document.getElementById("app-shell")?.setAttribute("data-sidebar-collapsed", String(saved));
    } catch {
      // Keep the expanded default when browser storage is unavailable.
    }

    const openSearch = () => {
      setCollapsed(false);
      applyCollapsed(false);
      window.requestAnimationFrame(() => document.getElementById("sidebar-shop-search")?.focus());
    };
    window.addEventListener(searchEvent, openSearch);
    return () => window.removeEventListener(searchEvent, openSearch);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    applyCollapsed(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      aria-controls="desktop-sidebar-navigation"
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        {collapsed ? <path d="m14 9 3 3-3 3" /> : <path d="m17 9-3 3 3 3" />}
      </svg>
    </button>
  );
}

export function SidebarSearchButton() {
  return (
    <button
      type="button"
      className="sidebar-collapsed-only mt-5 h-10 w-full items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      aria-label="Expand sidebar and search shop records"
      title="Search shop records"
      onClick={() => window.dispatchEvent(new Event(searchEvent))}
    >
      <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
        <circle cx="11" cy="11" r="7" />
        <path strokeLinecap="round" d="m16 16 4 4" />
      </svg>
    </button>
  );
}
