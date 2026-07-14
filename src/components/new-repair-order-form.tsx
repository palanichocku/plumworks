"use client";

import { useMemo, useState } from "react";
import { createRepairOrder } from "@/app/(app)/repair-orders/actions";

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

export function NewRepairOrderForm({ customers }: { customers: CustomerOption[] }) {
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
  const vehicles = useMemo(
    () => customers.find((customer) => customer.id === customerId)?.vehicles ?? [],
    [customerId, customers],
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

  return (
    <form action={createRepairOrder} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Customer</legend>
        <div className="flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="radio" name="customerMode" value="existing" checked={customerMode === "existing"} disabled={!customers.length} onChange={() => selectCustomerMode("existing")} />Select existing customer</label>
          <label className="flex items-center gap-2"><input type="radio" name="customerMode" value="new" checked={customerMode === "new"} onChange={() => selectCustomerMode("new")} />Add new customer</label>
        </div>
        {customerMode === "existing" ? <select id="customerId" name="customerId" aria-label="Existing customer" required value={customerId} onChange={(event) => selectCustomer(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100">
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}
        </select> : <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-800 sm:col-span-2">Name<input name="displayName" type="text" maxLength={200} required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">Phone <span className="font-normal text-slate-500">(optional)</span><input name="phone" type="tel" maxLength={40} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">Email <span className="font-normal text-slate-500">(optional)</span><input name="email" type="email" maxLength={254} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800 sm:col-span-2">Address <span className="font-normal text-slate-500">(optional)</span><input name="addressLine1" type="text" maxLength={200} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">City <span className="font-normal text-slate-500">(optional)</span><input name="city" type="text" maxLength={100} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">State <span className="font-normal text-slate-500">(optional)</span><input name="state" type="text" maxLength={30} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">Postal code <span className="font-normal text-slate-500">(optional)</span><input name="postalCode" type="text" maxLength={20} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
        </div>}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Vehicle</legend>
        <div className="flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="radio" name="vehicleMode" value="existing" checked={vehicleMode === "existing"} disabled={customerMode === "new" || !vehicles.length} onChange={() => setVehicleMode("existing")} />Select existing vehicle</label>
          <label className="flex items-center gap-2"><input type="radio" name="vehicleMode" value="new" checked={vehicleMode === "new"} onChange={() => setVehicleMode("new")} />Add new vehicle</label>
        </div>
        {vehicleMode === "existing" ? <select id="vehicleId" name="vehicleId" aria-label="Existing vehicle" required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900">
          {vehicles.map((vehicle) => {
            const description = [vehicle.year, vehicle.make, vehicle.model]
              .filter(Boolean)
              .join(" ") || "Vehicle details unavailable";
            const label = vehicle.licensePlate
              ? `${description} · ${vehicle.licensePlate}`
              : description;
            return <option key={vehicle.id} value={vehicle.id}>{label}</option>;
          })}
        </select> : <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-800">Year<input name="year" type="number" min="1886" max={new Date().getFullYear() + 1} required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">Make<input name="make" type="text" maxLength={100} required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">Model<input name="model" type="text" maxLength={100} required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">License plate <span className="font-normal text-slate-500">(optional)</span><input name="licensePlate" type="text" maxLength={30} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">VIN <span className="font-normal text-slate-500">(optional)</span><input name="vin" type="text" maxLength={50} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">Mileage <span className="font-normal text-slate-500">(optional)</span><input name="mileage" type="number" min="0" max="10000000" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
        </div>}
      </fieldset>
      {customerMode === "new" && <p className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-800">A new customer must be created with a new vehicle.</p>}
      <p className="text-sm text-slate-600">This creates a draft only. Parts, labor, and invoice finalization are not included yet.</p>
      <button type="submit" disabled={(customerMode === "existing" && !customerId) || (vehicleMode === "existing" && !vehicleId)} className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300">Save draft</button>
    </form>
  );
}
