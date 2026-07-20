"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createRepairOrder } from "@/app/(app)/repair-orders/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RepairOrderLayoutSelector } from "@/components/repair-order-layout-preview";
import { resolveRepairOrderLayout, type RepairOrderLayout } from "@/lib/repair-order-layout";

type CustomerOption = {
  id: string;
  displayName: string;
  vehicles: Array<{
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    licensePlate: string | null;
  }>;
};

type VehicleSuggestion = { make: string | null; model: string | null };

function cleanSuggestion(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function NewRepairOrderForm({
  customers,
  citySuggestions,
  vehicleSuggestions,
  role,
}: {
  customers: CustomerOption[];
  citySuggestions: string[];
  vehicleSuggestions: VehicleSuggestion[];
  role: string | null;
}) {
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear + 2 - 1970 }, (_, index) => currentYear + 1 - index);
  const initialCustomer = customers[0];
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    customers.length ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState(initialCustomer?.id ?? "");
  const [vehicleId, setVehicleId] = useState(
    initialCustomer?.vehicles[0]?.id ?? "",
  );
  const [vehicleMode, setVehicleMode] = useState<"existing" | "new">(
    initialCustomer?.vehicles.length ? "existing" : "new",
  );
  const [newVehicleMake, setNewVehicleMake] = useState("");
  const [requestedLayout, setRequestedLayout] = useState<RepairOrderLayout>("classic");
  const layout = resolveRepairOrderLayout(role, requestedLayout);
  const vehicles = useMemo(
    () => customers.find((customer) => customer.id === customerId)?.vehicles ?? [],
    [customerId, customers],
  );
  const makeSuggestions = useMemo(
    () => Array.from(new Set(vehicleSuggestions.flatMap(({ make }) => make ? [cleanSuggestion(make)] : []))).sort(),
    [vehicleSuggestions],
  );
  const modelSuggestions = useMemo(() => {
    const normalizedMake = cleanSuggestion(newVehicleMake);
    return Array.from(new Set(vehicleSuggestions.flatMap(({ make, model }) => {
      if (!model || (normalizedMake && cleanSuggestion(make ?? "") !== normalizedMake)) return [];
      return [cleanSuggestion(model)];
    }))).sort();
  }, [newVehicleMake, vehicleSuggestions]);
  const cities = useMemo(
    () => Array.from(new Set(citySuggestions.map(cleanSuggestion))).sort(),
    [citySuggestions],
  );

  function selectCustomer(nextCustomerId: string) {
    const nextCustomer = customers.find(
      (customer) => customer.id === nextCustomerId,
    );
    setCustomerId(nextCustomerId);
    setVehicleId(nextCustomer?.vehicles[0]?.id ?? "");
    setVehicleMode(nextCustomer?.vehicles.length ? "existing" : "new");
  }

  function selectCustomerMode(nextMode: "existing" | "new") {
    setCustomerMode(nextMode);
    if (nextMode === "new") {
      setVehicleMode("new");
      setVehicleId("");
      return;
    }
    const customer = customers.find((entry) => entry.id === customerId);
    setVehicleMode(customer?.vehicles.length ? "existing" : "new");
    setVehicleId(customer?.vehicles[0]?.id ?? "");
  }

  const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 transition-all duration-150 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-500/10";
  const labelClass = "text-xs font-semibold tracking-wide text-slate-600 uppercase";

  const formClass = layout === "split"
    ? "mx-auto max-w-7xl space-y-6 overflow-x-clip rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8"
    : layout === "guided"
      ? "mx-auto max-w-5xl space-y-6 rounded-2xl bg-slate-100 p-4 md:p-6"
      : "mx-auto max-w-3xl space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8";
  const sectionClass = layout === "guided" || layout === "split"
    ? "space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    : "space-y-5 border-t border-slate-100 pt-6";

  return (
    <form action={createRepairOrder} className={formClass} data-repair-order-layout={layout}>
      <div>
        <RepairOrderLayoutSelector role={role} layout={layout} onChange={setRequestedLayout} />
      </div>
      <div data-ro-section="heading">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Create Repair Order</h2>
        <p className="mt-1 text-sm text-slate-500">Initialize a new active check-in sheet or service draft.</p>
      </div>

      <div
        className={layout === "split" ? "grid items-start gap-6 lg:grid-cols-2" : layout === "guided" ? "space-y-6" : "space-y-8"}
        data-ro-section="customer-vehicle-grid"
      >
      <fieldset className={sectionClass}>
        <legend className="text-sm font-bold text-slate-800 tracking-wide">Customer Information</legend>
        
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs font-medium">
          <button type="button" disabled={!customers.length} onClick={() => selectCustomerMode("existing")} className={`rounded-md px-4 py-1.5 transition-all ${customerMode === "existing" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-500 hover:text-slate-900 disabled:opacity-50"}`}>
            Existing Customer
          </button>
          <button type="button" onClick={() => selectCustomerMode("new")} className={`rounded-md px-4 py-1.5 transition-all ${customerMode === "new" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-500 hover:text-slate-900"}`}>
            New Customer
          </button>
          <input type="hidden" name="customerMode" value={customerMode} />
        </div>

        {customerMode === "existing" ? (
          <div className="animate-fadeIn">
            <label className={labelClass} htmlFor="customerId">Select Profile</label>
            <select id="customerId" name="customerId" required value={customerId} onChange={(event) => selectCustomer(event.target.value)} className={inputClass}>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}
            </select>
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-6 animate-fadeIn">
            <label className={`${labelClass} sm:col-span-6`}>Customer Name <span className="text-red-500">*</span>
              <input name="displayName" type="text" maxLength={200} required placeholder="John Doe" className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-3`}>Phone Number
              <input name="phone" type="tel" maxLength={40} placeholder="(555) 000-0000" className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-3`}>Email Address
              <input name="email" type="email" maxLength={254} placeholder="name@example.com" className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-6`}>Street Address
              <input name="addressLine1" type="text" maxLength={200} placeholder="123 Main St" className={inputClass} />
            </label>
            <div className="col-span-full grid min-w-0 grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(5rem,7rem)_minmax(8rem,10rem)]" data-ro-section="customer-locality-grid">
              <div className="min-w-0">
                <label className={`block ${labelClass}`} htmlFor="customer-city">City</label>
                <input id="customer-city" name="city" type="text" list="customer-city-suggestions" maxLength={100} placeholder="Detroit" className={inputClass} />
                <datalist id="customer-city-suggestions">{cities.map((city) => <option key={city} value={city} />)}</datalist>
              </div>
              <div className="min-w-0">
                <label className={`block ${labelClass}`} htmlFor="customer-state">State</label>
                <input id="customer-state" name="state" type="text" maxLength={30} defaultValue="MI" className={inputClass} />
              </div>
              <div className="min-w-0">
                <label className={`block whitespace-nowrap ${labelClass}`} htmlFor="customer-postal-code">Postal Code</label>
                <input id="customer-postal-code" name="postalCode" type="text" maxLength={20} placeholder="48201" className={inputClass} />
              </div>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className={sectionClass}>
        <legend className="text-sm font-bold text-slate-800 tracking-wide">Vehicle Assignment</legend>
        
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs font-medium">
          <button type="button" disabled={customerMode === "new" || !vehicles.length} onClick={() => setVehicleMode("existing")} className={`rounded-md px-4 py-1.5 transition-all ${vehicleMode === "existing" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-500 hover:text-slate-900 disabled:opacity-40"}`}>
            Existing Vehicle
          </button>
          <button type="button" onClick={() => setVehicleMode("new")} className={`rounded-md px-4 py-1.5 transition-all ${vehicleMode === "new" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-500 hover:text-slate-900"}`}>
            New Vehicle
          </button>
          <input type="hidden" name="vehicleMode" value={vehicleMode} />
        </div>

        {vehicleMode === "existing" ? (
          <div className="animate-fadeIn">
            <label className={labelClass} htmlFor="vehicleId">Select Active Vehicle</label>
            <select id="vehicleId" name="vehicleId" required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className={inputClass}>
              {vehicles.map((vehicle) => {
                const description = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";
                return <option key={vehicle.id} value={vehicle.id}>{vehicle.licensePlate ? `${description} [${vehicle.licensePlate}]` : description}</option>;
              })}
            </select>
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-6 animate-fadeIn">
            <label className={`${labelClass} sm:col-span-2`}>Model Year <span className="text-red-500">*</span>
              <select name="year" required defaultValue={currentYear} className={inputClass}>
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Make <span className="text-red-500">*</span>
              <input name="make" type="text" list="vehicle-make-suggestions" maxLength={100} required value={newVehicleMake} onChange={(event) => setNewVehicleMake(event.target.value)} placeholder="e.g. FORD" className={inputClass} />
              <datalist id="vehicle-make-suggestions">{makeSuggestions.map((make) => <option key={make} value={make} />)}</datalist>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Model <span className="text-red-500">*</span>
              <input name="model" type="text" list="vehicle-model-suggestions" maxLength={100} required placeholder="e.g. F-150" className={inputClass} />
              <datalist id="vehicle-model-suggestions">{modelSuggestions.map((model) => <option key={model} value={model} />)}</datalist>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>License Plate
              <input name="licensePlate" type="text" maxLength={30} placeholder="ABC-1234" className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>VIN
              <input name="vin" type="text" maxLength={50} placeholder="17-Digit Vehicle ID" className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Current Odometer
              <input name="mileage" type="number" min="0" max="10000000" placeholder="0" className={inputClass} />
            </label>
          </div>
        )}
      </fieldset>
      </div>

      <section className={sectionClass} aria-labelledby="new-repair-order-concerns-title" data-ro-section="concerns">
        <div>
          <h2 id="new-repair-order-concerns-title" className="text-base font-bold text-slate-900">Customer Concerns &amp; Recommendations</h2>
          <p className="mt-1 text-sm text-slate-600">Capture the customer’s words separately from the shop’s findings.</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700" htmlFor="customerComplaint">
            Customer Complaint <span className="font-normal text-slate-500">(optional)</span>
            <textarea id="customerComplaint" name="customerComplaint" rows={5} className={inputClass} aria-describedby="customerComplaint-help" />
            <span id="customerComplaint-help" className="mt-2 block text-xs font-normal leading-5 text-slate-500">Describe the concern, symptoms, noises, warning lights, or service requested by the customer.</span>
          </label>
          <label className="text-sm font-semibold text-slate-700" htmlFor="recommendation">
            Service Recommendation <span className="font-normal text-slate-500">(optional)</span>
            <textarea id="recommendation" name="recommendation" rows={5} className={inputClass} aria-describedby="recommendation-help" />
            <span id="recommendation-help" className="mt-2 block text-xs font-normal leading-5 text-slate-500">Record the shop’s inspection findings, recommended repairs, or future service advice.</span>
          </label>
        </div>
      </section>

      <div className="min-w-0 space-y-4 border-t border-slate-100 pt-6" data-ro-section="actions">
        {customerMode === "new" && (
          <div className="flex gap-3 rounded-xl bg-sky-50 p-4 text-sm text-sky-800">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-200 text-xs font-bold text-sky-900">i</span>
            <p className="font-medium">System Constraint: Creating a brand new customer requires capturing initial vehicle information context sequentially.</p>
          </div>
        )}
        
        <div className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl bg-slate-50 p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <p className="min-w-0 flex-1 basis-80 text-xs text-slate-500">
            Drafting does not lock order sequence counters or affect live inventory items. Parts configuration interfaces activate once the workspace profile passes draft validation stages.
          </p>
          <div className="flex min-w-0 w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          <Link href="/repair-orders" className="inline-flex w-full min-w-0 items-center justify-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white sm:w-auto">Cancel</Link>
          <FormSubmitButton 
            pendingLabel="Saving..." 
            disabled={(customerMode === "existing" && !customerId) || (vehicleMode === "existing" && !vehicleId)} 
            className="inline-flex w-full min-w-0 max-w-full items-center justify-center whitespace-normal rounded-lg bg-sky-600 px-5 py-2.5 text-center text-sm font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-sky-700 focus:outline-none focus:ring-4 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:w-auto"
          >
            Save Document Draft
          </FormSubmitButton>
          </div>
        </div>
      </div>
    </form>
  );
}
