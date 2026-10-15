"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createRepairOrder } from "@/app/(app)/repair-orders/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { CustomerPhoneInput } from "@/components/customer-phone-input";
import { RepairOrderCustomerCombobox } from "@/components/repair-order-customer-combobox";
import type { RepairOrderCustomerSearchResult } from "@/app/(app)/repair-orders/customer-search-actions";

type VehicleSuggestion = { make: string | null; model: string | null };

function cleanSuggestion(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function NewRepairOrderForm({
  citySuggestions,
  vehicleSuggestions,
  initialCustomer = null,
  initialVehicleId = null,
}: {
  citySuggestions: string[];
  vehicleSuggestions: VehicleSuggestion[];
  initialCustomer?: RepairOrderCustomerSearchResult | null;
  initialVehicleId?: string | null;
}) {
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear + 2 - 1970 }, (_, index) => currentYear + 1 - index);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(initialCustomer ? "existing" : "existing");
  const [selectedCustomer, setSelectedCustomer] = useState<RepairOrderCustomerSearchResult | null>(initialCustomer);
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? initialCustomer?.vehicles[0]?.id ?? "");
  const [vehicleMode, setVehicleMode] = useState<"existing" | "new">(
    initialVehicleId || initialCustomer?.vehicles.length ? "existing" : "new",
  );
  const [newVehicleMake, setNewVehicleMake] = useState("");
  const vehicles = selectedCustomer?.vehicles ?? [];
  const selectedVehicle = vehicleMode === "existing" ? vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null : null;

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

  function selectCustomer(nextCustomer: RepairOrderCustomerSearchResult | null) {
    setSelectedCustomer(nextCustomer);
    setCustomerMode("existing");
    const nextVehicleId = nextCustomer?.vehicles[0]?.id ?? "";
    setVehicleId(nextVehicleId);
    setVehicleMode(nextVehicleId ? "existing" : "new");
  }

  function startNewCustomer() {
    setCustomerMode("new");
    setSelectedCustomer(null);
    setVehicleId("");
    setVehicleMode("new");
  }

  function returnToCustomerSearch() {
    setCustomerMode("existing");
    setSelectedCustomer(null);
    setVehicleId("");
    setVehicleMode("new");
  }

  const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 transition-all duration-150 placeholder:text-slate-400 focus:border-brand-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-primary/10";
  const labelClass = "text-xs font-semibold tracking-wide text-slate-600 uppercase";
  const sectionClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";

  return (
    <form action={createRepairOrder} className="mx-auto max-w-6xl space-y-5" data-repair-order-layout="check-in">
      <input type="hidden" name="customerMode" value={customerMode} />
      <input type="hidden" name="vehicleMode" value={vehicleMode} />

      <section className={sectionClass} aria-labelledby="check-in-customer-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="check-in-customer-title" className="text-base font-bold text-slate-900">Customer</h2>
            <p className="mt-1 text-sm text-slate-500">Find the customer first, or add them if they are new to the shop.</p>
          </div>
          {customerMode === "existing" ? (
            <button type="button" onClick={startNewCustomer} className="text-sm font-semibold text-brand-primary underline underline-offset-4">+ New customer</button>
          ) : (
            <button type="button" onClick={returnToCustomerSearch} className="text-sm font-semibold text-brand-primary underline underline-offset-4">Back to customer search</button>
          )}
        </div>

        <div className="mt-4">
          {customerMode === "existing" ? (
            <RepairOrderCustomerCombobox selected={selectedCustomer} onSelect={selectCustomer} inputClass={inputClass} labelClass={labelClass} />
          ) : (
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-6">
              <label className={`${labelClass} sm:col-span-6`}>Customer name <span className="text-red-500">*</span>
                <input name="displayName" type="text" maxLength={200} required placeholder="Customer name" className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>Primary phone
                <CustomerPhoneInput maxLength={40} placeholder="(555) 000-0000" className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>Email <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                <input name="email" type="email" maxLength={254} placeholder="name@example.com" className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>Additional phone <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                <CustomerPhoneInput name="phone2" maxLength={40} placeholder="(555) 000-0000" className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>Street address <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                <input name="addressLine1" type="text" maxLength={200} className={inputClass} />
              </label>
              <div className="sm:col-span-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem_9rem]">
                <label className={labelClass}>City
                  <input name="city" type="text" list="customer-city-suggestions" maxLength={100} className={inputClass} />
                  <datalist id="customer-city-suggestions">{cities.map((city) => <option key={city} value={city} />)}</datalist>
                </label>
                <label className={labelClass}>State
                  <input name="state" type="text" maxLength={30} defaultValue="MI" className={inputClass} />
                </label>
                <label className={labelClass}>Postal code
                  <input name="postalCode" type="text" maxLength={20} className={inputClass} />
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="check-in-vehicle-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="check-in-vehicle-title" className="text-base font-bold text-slate-900">Vehicle</h2>
            <p className="mt-1 text-sm text-slate-500">Choose the vehicle being checked in.</p>
          </div>
          {customerMode === "existing" && selectedCustomer ? (
            vehicleMode === "existing" ? (
              <button type="button" onClick={() => { setVehicleMode("new"); setVehicleId(""); }} className="text-sm font-semibold text-brand-primary underline underline-offset-4">+ New vehicle</button>
            ) : vehicles.length ? (
              <button type="button" onClick={() => { setVehicleMode("existing"); setVehicleId(vehicles[0]?.id ?? ""); }} className="text-sm font-semibold text-brand-primary underline underline-offset-4">Choose saved vehicle</button>
            ) : null
          ) : null}
        </div>

        {customerMode === "existing" && !selectedCustomer ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Choose a customer to see their vehicles.</p>
        ) : null}

        {customerMode === "existing" && selectedCustomer && vehicleMode === "existing" ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {vehicles.map((vehicle) => {
              const description = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";
              const selected = vehicle.id === vehicleId;
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => { setVehicleId(vehicle.id); setVehicleMode("existing"); }}
                  className={`rounded-lg border px-3 py-2.5 text-left transition ${selected ? "border-brand-primary bg-brand-subtle ring-2 ring-brand-primary/15" : "border-slate-200 bg-white hover:border-brand-primary/50 hover:bg-slate-50"}`}
                >
                  <span className="block text-sm font-semibold leading-5 text-slate-900">{description}</span>
                  <span className="block text-xs leading-5 text-slate-500">{vehicle.licensePlate || "No plate recorded"}</span>
                  <span className="block text-xs leading-5 text-slate-400">Last mileage: {vehicle.lastRecordedMileage === null ? "Not recorded" : vehicle.lastRecordedMileage.toLocaleString()}</span>
                </button>
              );
            })}
            <input type="hidden" name="vehicleId" value={vehicleId} />
          </div>
        ) : null}

        {(customerMode === "new" || (customerMode === "existing" && selectedCustomer && vehicleMode === "new")) ? (
          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-6">
            <label className={`${labelClass} sm:col-span-2`}>Year <span className="text-red-500">*</span>
              <select name="year" required defaultValue={currentYear} className={inputClass}>
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Make <span className="text-red-500">*</span>
              <input name="make" type="text" list="vehicle-make-suggestions" maxLength={100} required value={newVehicleMake} onChange={(event) => setNewVehicleMake(event.target.value)} placeholder="FORD" className={inputClass} />
              <datalist id="vehicle-make-suggestions">{makeSuggestions.map((make) => <option key={make} value={make} />)}</datalist>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Model <span className="text-red-500">*</span>
              <input name="model" type="text" list="vehicle-model-suggestions" maxLength={100} required placeholder="F-150" className={inputClass} />
              <datalist id="vehicle-model-suggestions">{modelSuggestions.map((model) => <option key={model} value={model} />)}</datalist>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Engine
              <input name="engine" type="text" maxLength={100} placeholder="3.5L V6" className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>License plate
              <input name="licensePlate" type="text" maxLength={30} placeholder="ABC-1234" className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>VIN
              <input name="vin" type="text" maxLength={50} placeholder="VIN" className={inputClass} />
            </label>
          </div>
        ) : null}

        {(customerMode === "new" || selectedCustomer) ? (
          <label className={`${labelClass} mt-5 block max-w-sm`}>Current mileage <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
            <input key={`${vehicleMode}:${vehicleId}`} name="mileage" type="number" min="1" max="10000000" placeholder={selectedVehicle?.lastRecordedMileage ? `Last: ${selectedVehicle.lastRecordedMileage.toLocaleString()}` : "Enter current mileage"} className={inputClass} />
          </label>
        ) : null}
      </section>

      <section className={sectionClass} aria-labelledby="check-in-concern-title">
        <h2 id="check-in-concern-title" className="text-base font-bold text-slate-900">Customer concern</h2>
        <p className="mt-1 text-sm text-slate-500">Capture why the vehicle is here. Inspection findings and shop recommendations are added on the repair order.</p>
        <textarea name="customerComplaint" rows={4} placeholder="What did the customer ask us to check or repair?" className={`${inputClass} mt-4`} />
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <Link href="/repair-orders" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white">Cancel</Link>
        <FormSubmitButton
          pendingLabel="Creating..."
          disabled={(customerMode === "existing" && !selectedCustomer) || (vehicleMode === "existing" && !vehicleId)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          Create repair order →
        </FormSubmitButton>
      </div>
    </form>
  );
}
