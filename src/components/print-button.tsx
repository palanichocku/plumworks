"use client";

export function PrintButton({ label = "Print", ariaLabel }: { label?: string; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      aria-label={ariaLabel}
      className="print-hidden rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700"
    >
      {label}
    </button>
  );
}
