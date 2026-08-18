import { legacyEmail, legacyPhone } from "./legacy-customer-contact.mjs";

function rawValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const value = rawData[field];
  return value === null || value === undefined ? null : String(value).trim();
}

function cleanText(value) {
  return value?.replaceAll(/\s+/g, " ").trim() || null;
}

export function legacyNote(value) {
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note || /^\[object\s+[^\]]+\]$/i.test(note)) return null;
  return note;
}

function noteValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  return legacyNote(rawData[field]);
}

export function preservedOperationalNote(existingNote, incomingNote) {
  return typeof existingNote === "string" && existingNote.trim() ? existingNote : legacyNote(incomingNote);
}

function cleanInteger(value, minimum = 0, maximum = 2147483647) {
  if (!value) return null;
  const number = Number.parseInt(value.replaceAll(/[^0-9-]/g, ""), 10);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

export function customerData(row) {
  const legacyCustno = cleanText(row.legacyCustno);
  const displayName = cleanText(rawValue(row.rawData, "CUSTOMER"));
  if (!legacyCustno || !displayName) return null;
  return {
    legacyCustno,
    displayName,
    phone: legacyPhone(rawValue(row.rawData, "PHONE")).value,
    phone2: legacyPhone(rawValue(row.rawData, "PHONE2")).value,
    email: legacyEmail(rawValue(row.rawData, "EMAIL")).value,
    addressLine1: cleanText(rawValue(row.rawData, "ADDRESS")),
    addressLine2: cleanText(rawValue(row.rawData, "ADDRESS2")),
    city: cleanText(rawValue(row.rawData, "CITY")),
    state: cleanText(rawValue(row.rawData, "STATE"))?.toUpperCase() ?? null,
    postalCode: cleanText(rawValue(row.rawData, "ZIP")),
    notes: noteValue(row.rawData, "NOTE"),
    message: cleanText(rawValue(row.rawData, "MESSAGE")),
    legacySourceTable: "Cust.DBF",
  };
}

export function customerContactIssues(row) {
  return {
    phone: legacyPhone(rawValue(row.rawData, "PHONE")).issue,
    phone2: legacyPhone(rawValue(row.rawData, "PHONE2")).issue,
    email: legacyEmail(rawValue(row.rawData, "EMAIL")).issue,
  };
}

export function vehicleData(row) {
  const legacyCustno = cleanText(row.legacyCustno);
  const legacyCarno = cleanText(row.legacyCarno);
  if (!legacyCustno || !legacyCarno) return null;
  return {
    legacyCustno,
    legacyCarno,
    year: cleanInteger(rawValue(row.rawData, "YEAR"), 1886, 2200),
    make: cleanText(rawValue(row.rawData, "MAKE")),
    model: cleanText(rawValue(row.rawData, "MODEL")),
    engine: cleanText(rawValue(row.rawData, "MOTOR")),
    vin: cleanText(rawValue(row.rawData, "VIN"))?.toUpperCase() ?? null,
    licensePlate: cleanText(rawValue(row.rawData, "LICENSE"))?.toUpperCase() ?? null,
    odometer: cleanInteger(rawValue(row.rawData, "ODOMETER")),
    notes: noteValue(row.rawData, "NOTE") ?? noteValue(row.rawData, "HISTNOTES"),
    message: cleanText(rawValue(row.rawData, "MESSAGE")),
    legacySourceTable: "vehicles.DBF",
  };
}

export function reconcileCustomerVehicleRows(rawCustomers, rawVehicles) {
  const invalidCustomerId = rawCustomers.filter((row) => !cleanText(row.legacyCustno)).length;
  const blankCustomerName = rawCustomers.filter((row) => cleanText(row.legacyCustno) && !cleanText(rawValue(row.rawData, "CUSTOMER"))).length;
  const validCustomers = rawCustomers.map(customerData).filter(Boolean);
  const customersById = new Map(validCustomers.map((row) => [row.legacyCustno, row]));
  const duplicateCustomerId = validCustomers.length - customersById.size;
  const transformedCustomers = [...customersById.values()];
  const additionalPhoneSourceValues = validCustomers.filter((row) => row.phone2 !== null).length;
  const additionalPhoneDestinationValues = transformedCustomers.filter((row) => row.phone2 !== null).length;
  const additionalPhoneMissingValues = transformedCustomers.filter((row) => row.phone2 === null).length;
  const customerContextSourceValues = validCustomers.filter((row) => row.notes !== null).length;
  const customerContextDestinationValues = transformedCustomers.filter((row) => row.notes !== null).length;
  const invalidCustomerPhones = rawCustomers.filter((row) => customerContactIssues(row).phone).length;
  const invalidCustomerPhone2 = rawCustomers.filter((row) => customerContactIssues(row).phone2).length;
  const invalidCustomerEmails = rawCustomers.filter((row) => customerContactIssues(row).email).length;

  const invalidVehicleId = rawVehicles.filter((row) => !cleanText(row.legacyCustno) || !cleanText(row.legacyCarno)).length;
  const validVehicles = rawVehicles.map(vehicleData).filter(Boolean);
  const linkedVehicles = validVehicles.filter((row) => customersById.has(row.legacyCustno));
  const missingCustomerLink = validVehicles.length - linkedVehicles.length;
  const vehiclesById = new Map(linkedVehicles.map((row) => [row.legacyCarno, row]));
  const duplicateVehicleId = linkedVehicles.length - vehiclesById.size;
  const transformedVehicles = [...vehiclesById.values()];
  const vehicleContextSourceValues = linkedVehicles.filter((row) => row.notes !== null).length;
  const vehicleContextDestinationValues = transformedVehicles.filter((row) => row.notes !== null).length;
  const engineSourceValues = validVehicles.filter((row) => row.engine !== null).length;
  const engineDestinationValues = transformedVehicles.filter((row) => row.engine !== null).length;

  return {
    customers: transformedCustomers,
    vehicles: transformedVehicles,
    reasons: {
      invalidCustomerId,
      blankCustomerName,
      duplicateCustomerId,
      invalidCustomerPhones,
      invalidCustomerPhone2,
      invalidCustomerEmails,
      invalidVehicleId,
      missingCustomerLink,
      duplicateVehicleId,
    },
    secondaryContact: {
      sourceValues: additionalPhoneSourceValues,
      destinationValues: additionalPhoneDestinationValues,
      missingValues: additionalPhoneMissingValues,
      mismatches: 0,
    },
    engine: {
      sourceVehiclesEvaluated: rawVehicles.length,
      sourceValues: engineSourceValues,
      destinationValues: engineDestinationValues,
      missingValues: rawVehicles.length - engineSourceValues,
      mismatches: 0,
      unresolved: invalidVehicleId + missingCustomerLink,
      ambiguous: duplicateVehicleId,
    },
    persistentContext: {
      customerSourceValues: customerContextSourceValues,
      customerDestinationValues: customerContextDestinationValues,
      customerMismatches: 0,
      vehicleSourceValues: vehicleContextSourceValues,
      vehicleDestinationValues: vehicleContextDestinationValues,
      vehicleMismatches: 0,
    },
  };
}
