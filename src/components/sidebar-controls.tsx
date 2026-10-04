"use client";

import { useEffect, useSyncExternalStore } from "react";

const storageKey = "plumworks:sidebar-collapsed";
const changeEvent = "plumworks:sidebar-change";
let fallbackCollapsed = true;

function readCollapsed() {
  try {
    return window.localStorage.getItem(storageKey) !== "false";
  } catch {
    return fallbackCollapsed;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changeEvent, listener);
  };
}

function saveCollapsed(collapsed: boolean) {
  fallbackCollapsed = collapsed;
  document.getElementById("app-shell")?.setAttribute("data-sidebar-collapsed", String(collapsed));
  try {
    window.localStorage.setItem(storageKey, String(collapsed));
  } catch {
    // The control still works when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function SidebarToggle() {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => true);

  useEffect(() => {
    document.getElementById("app-shell")?.setAttribute("data-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  return (
    <button
      type="button"
      onClick={() => saveCollapsed(!collapsed)}
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
      onClick={() => {
        saveCollapsed(false);
        window.requestAnimationFrame(() => document.getElementById("sidebar-shop-search")?.focus());
      }}
    >
      <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
        <circle cx="11" cy="11" r="7" />
        <path strokeLinecap="round" d="m16 16 4 4" />
      </svg>
    </button>
  );
}
