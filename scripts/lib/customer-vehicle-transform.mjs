function rawValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const value = rawData[field];
  return value === null || value === undefined ? null : String(value).trim();
}

function cleanText(value) {
  return value?.replaceAll(/\s+/g, " ").trim() || null;
}

function cleanEmail(value) {
  const email = cleanText(value)?.toLowerCase();
  return email && email.includes("@") ? email : null;
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
    phone: cleanText(rawValue(row.rawData, "PHONE")),
    phone2: cleanText(rawValue(row.rawData, "PHONE2")),
    email: cleanEmail(rawValue(row.rawData, "EMAIL")),
    addressLine1: cleanText(rawValue(row.rawData, "ADDRESS")),
    addressLine2: cleanText(rawValue(row.rawData, "ADDRESS2")),
    city: cleanText(rawValue(row.rawData, "CITY")),
    state: cleanText(rawValue(row.rawData, "STATE"))?.toUpperCase() ?? null,
    postalCode: cleanText(rawValue(row.rawData, "ZIP")),
    notes: cleanText(rawValue(row.rawData, "NOTE")),
    message: cleanText(rawValue(row.rawData, "MESSAGE")),
    legacySourceTable: "Cust.DBF",
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
    notes: cleanText(rawValue(row.rawData, "NOTE")) ?? cleanText(rawValue(row.rawData, "HISTNOTES")),
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

  const invalidVehicleId = rawVehicles.filter((row) => !cleanText(row.legacyCustno) || !cleanText(row.legacyCarno)).length;
  const validVehicles = rawVehicles.map(vehicleData).filter(Boolean);
  const linkedVehicles = validVehicles.filter((row) => customersById.has(row.legacyCustno));
  const missingCustomerLink = validVehicles.length - linkedVehicles.length;
  const vehiclesById = new Map(linkedVehicles.map((row) => [row.legacyCarno, row]));
  const duplicateVehicleId = linkedVehicles.length - vehiclesById.size;

  return {
    customers: [...customersById.values()],
    vehicles: [...vehiclesById.values()],
    reasons: {
      invalidCustomerId,
      blankCustomerName,
      duplicateCustomerId,
      invalidVehicleId,
      missingCustomerLink,
      duplicateVehicleId,
    },
  };
}
