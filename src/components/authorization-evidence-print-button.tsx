"use client";

import { useEffect, useRef } from "react";

export function AuthorizationEvidencePrintButton() {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = buttonRef.current?.closest("div.space-y-6");
    root?.classList.add("authorization-evidence-print-root");
    return () => root?.classList.remove("authorization-evidence-print-root");
  }, []);

  return <>
    <button ref={buttonRef} type="button" onClick={() => window.print()} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary print:hidden">Print / Save as PDF</button>
    <style jsx global>{`
      @media print {
        @page {
          size: Letter portrait;
          margin: 0.25in;
        }

        .authorization-evidence-print-root {
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          gap: 0 !important;
          color: #0f172a !important;
          font-size: 7.25pt !important;
          line-height: 1.15 !important;
        }

        .authorization-evidence-print-root > header {
          display: block !important;
          margin: 0 0 5pt !important;
          padding: 0 0 4pt !important;
          border-bottom: 0.6pt solid #cbd5e1;
        }

        .authorization-evidence-print-root > header p,
        .authorization-evidence-print-root > header h1 {
          margin-top: 0 !important;
          margin-bottom: 2pt !important;
        }

        .authorization-evidence-print-root > header p:first-of-type {
          font-size: 6.5pt !important;
          letter-spacing: 0.04em !important;
        }

        .authorization-evidence-print-root > header h1 {
          font-size: 13pt !important;
          line-height: 1.05 !important;
        }

        .authorization-evidence-print-root > header p:last-of-type {
          max-width: none !important;
          font-size: 6.75pt !important;
          line-height: 1.15 !important;
        }

        .authorization-evidence-print-root > article {
          break-inside: auto !important;
          page-break-inside: auto !important;
          margin: 0 0 5pt !important;
          padding: 5pt !important;
          border-width: 0.6pt !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }

        .authorization-evidence-print-root > article > div:first-child {
          gap: 5pt !important;
          padding-bottom: 4pt !important;
        }

        .authorization-evidence-print-root > article > div:first-child > div {
          max-width: none !important;
        }

        .authorization-evidence-print-root article section {
          margin-top: 4pt !important;
          padding-top: 4pt !important;
          gap: 5pt !important;
        }

        .authorization-evidence-print-root article h2 {
          font-size: 8pt !important;
          line-height: 1.1 !important;
        }

        .authorization-evidence-print-root article h3 {
          font-size: 7.25pt !important;
          line-height: 1.1 !important;
        }

        .authorization-evidence-print-root article p,
        .authorization-evidence-print-root article dt,
        .authorization-evidence-print-root article dd,
        .authorization-evidence-print-root article li,
        .authorization-evidence-print-root article span {
          font-size: 6.75pt !important;
          line-height: 1.15 !important;
        }

        .authorization-evidence-print-root article dl {
          margin-top: 2pt !important;
          gap: 1.5pt 5pt !important;
        }

        .authorization-evidence-print-root article ul {
          margin-top: 2pt !important;
        }

        .authorization-evidence-print-root article li {
          padding: 2pt 3pt !important;
        }

        .authorization-evidence-print-root article .font-mono,
        .authorization-evidence-print-root article [class*="text-[10px]"] {
          font-size: 5.5pt !important;
          line-height: 1.05 !important;
        }

        .authorization-evidence-print-root article details {
          margin-top: 1pt !important;
        }

        .authorization-evidence-print-root article details > summary {
          display: none !important;
        }

        .authorization-evidence-print-root article details > p {
          display: block !important;
          margin-top: 1pt !important;
        }

        .authorization-evidence-print-root article section,
        .authorization-evidence-print-root article li,
        .authorization-evidence-print-root article dl,
        .authorization-evidence-print-root article > div:first-child {
          break-inside: auto !important;
          page-break-inside: auto !important;
        }

        .authorization-evidence-print-root > footer {
          margin-top: 3pt !important;
          padding-top: 3pt !important;
          font-size: 5.75pt !important;
          line-height: 1.1 !important;
        }
      }
    `}</style>
  </>;
}
