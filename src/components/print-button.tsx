"use client";

export function PrintButton({ label = "Print", ariaLabel }: { label?: string; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      aria-label={ariaLabel}
      className="print-hidden rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary"
    >
      {label}
    </button>
  );
}
