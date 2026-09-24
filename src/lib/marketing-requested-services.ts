// Public form values and server validation must use this same allowlist.
export const requestedServices = [
  { value: "diagnostics", label: "Warning Light / Diagnostics" },
  { value: "oil-filter", label: "Oil & Filter Service" },
  { value: "brakes", label: "Brake Inspection / Service" },
  { value: "maintenance", label: "Scheduled Maintenance" },
  { value: "climate-cooling", label: "A/C, Heating & Cooling" },
  { value: "battery-electrical", label: "Battery, Starting & Electrical" },
  { value: "steering-suspension", label: "Steering & Suspension" },
  { value: "transmission-clutch", label: "Transmission & Clutch" },
  { value: "engine", label: "Engine Concern / Repair" },
  { value: "undercar", label: "Undercar Inspection / Service" },
  { value: "other", label: "Other / Not Sure" },
] as const;

export const leadFormHelper = "Choose the option that best fits. We'll contact you using your preferred method to get the details and determine the next step.";

// Intake instructions belong to the form contract, even when older marketing
// records still contain narrative-form CTAs. Educational content stays editable.
export const serviceRequestCopy = "Select the service category that best fits and choose your preferred contact method. We'll contact you to get the details and determine the next step.";
