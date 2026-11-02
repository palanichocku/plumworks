"use client";

import { useEffect, useState } from "react";
import { preflightRepairOrderCheckIn, type RepairOrderCheckInPreflightResult } from "@/app/(app)/repair-orders/check-in-preflight-actions";

function vehicleDescription(conflict: NonNullable<RepairOrderCheckInPreflightResult["vehicleConflict"]>) {
  return [conflict.year, conflict.make, conflict.model].filter(Boolean).join(" ") || "Vehicle details unavailable";
}

export function RepairOrderCheckInPreflight() {
  const [result, setResult] = useState<RepairOrderCheckInPreflightResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>('form[data-repair-order-layout="check-in"]');
    if (!form) return;

    const handler = async (event: SubmitEvent) => {
      if (form.dataset.preflightPassed === "true") {
        delete form.dataset.preflightPassed;
        return;
      }

      event.preventDefault();
      setChecking(true);
      setResult(null);

      const vinInput = form.elements.namedItem("vin") as HTMLInputElement | null;
      vinInput?.classList.remove("border-red-500", "bg-red-50", "ring-2", "ring-red-200");
      vinInput?.removeAttribute("aria-invalid");

      try {
        const next = await preflightRepairOrderCheckIn(new FormData(form));
        setResult(next);

        if (next.vehicleConflict) {
          vinInput?.classList.add("border-red-500", "bg-red-50", "ring-2", "ring-red-200");
          vinInput?.setAttribute("aria-invalid", "true");
          vinInput?.focus();
          vinInput?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }

        if (next.customerMatches.length > 0) return;

        form.dataset.preflightPassed = "true";
        form.requestSubmit(event.submitter as HTMLElement | null);
      } finally {
        setChecking(false);
      }
    };

    form.addEventListener("submit", handler);
    return () => form.removeEventListener("submit", handler);
  }, []);

  function createAnyway() {
    const form = document.querySelector<HTMLFormElement>('form[data-repair-order-layout="check-in"]');
    if (!form) return;
    setResult(null);
    form.dataset.preflightPassed = "true";
    form.requestSubmit();
  }

  function useExistingCustomer(customerId: string) {
    const form = document.querySelector<HTMLFormElement>('form[data-repair-order-layout="check-in"]');
    if (!form) return;
    const mode = form.elements.namedItem("customerMode") as HTMLInputElement | null;
    if (mode) mode.value = "existing";
    let customerIdInput = form.elements.namedItem("customerId") as HTMLInputElement | null;
    if (!customerIdInput) {
      customerIdInput = document.createElement("input");
      customerIdInput.type = "hidden";
      customerIdInput.name = "customerId";
      form.appendChild(customerIdInput);
    }
    customerIdInput.value = customerId;
    setResult(null);
    form.dataset.preflightPassed = "true";
    form.requestSubmit();
  }

  if (checking) {
    return <p role="status" className="mx-auto mb-4 max-w-6xl rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600">Checking for an existing customer or vehicle…</p>;
  }

  if (result?.vehicleConflict) {
    const conflict = result.vehicleConflict;
    return <section role="alert" className="mx-auto mb-4 max-w-6xl rounded-xl border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950">
      <h2 className="font-bold">This VIN already belongs to an existing vehicle.</h2>
      <p className="mt-1">Correct the VIN below, or use the existing customer and vehicle instead.</p>
      <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">Vehicle</dt><dd>{vehicleDescription(conflict)}</dd>
        <dt className="font-semibold">VIN</dt><dd className="font-mono">{conflict.vin}</dd>
        <dt className="font-semibold">Plate</dt><dd>{conflict.licensePlate || "Not recorded"}</dd>
        <dt className="font-semibold">Customer</dt><dd>{conflict.customer.displayName}</dd>
        <dt className="font-semibold">Phone</dt><dd>{conflict.customer.phone || "Not recorded"}</dd>
        <dt className="font-semibold">Email</dt><dd>{conflict.customer.email || "Not recorded"}</dd>
        {(conflict.archived || conflict.customer.archived) ? <><dt className="font-semibold">Status</dt><dd>Archived — restore the existing record instead of creating a duplicate.</dd></> : null}
      </dl>
    </section>;
  }

  if (result?.customerMatches.length) {
    return <section role="alert" className="mx-auto mb-4 max-w-6xl rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950">
      <h2 className="font-bold">Possible existing customer found</h2>
      <p className="mt-1">Review the match before creating another customer record. You can use the existing customer or create the new customer anyway.</p>
      <div className="mt-3 space-y-3">
        {result.customerMatches.map((customer) => <div key={customer.id} className="rounded-lg border border-amber-200 bg-white p-3">
          <p className="font-semibold text-slate-950">{customer.displayName}</p>
          <p className="mt-1 text-slate-600">{customer.phone || "No phone"} · {customer.email || "No email"}</p>
          <p className="mt-1 text-xs font-medium text-amber-800">Matched on {customer.reasons.join(", ")}</p>
          <button type="button" onClick={() => useExistingCustomer(customer.id)} className="mt-3 rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white">Use Existing Customer</button>
        </div>)}
      </div>
      <button type="button" onClick={createAnyway} className="mt-4 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-semibold text-amber-950">Create Anyway</button>
    </section>;
  }

  return null;
}
