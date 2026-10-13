"use client";

export function AuthorizationEvidencePrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary print:hidden">Print / Save as PDF</button>;
}
