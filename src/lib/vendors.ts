export const MAX_VENDOR_NAME_LENGTH = 150;

export function cleanVendorName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeVendorName(value: string) {
  return cleanVendorName(value).toLocaleLowerCase("en-US");
}

export function validatedVendorName(value: string) {
  const name = cleanVendorName(value);
  if (!name) throw new Error("Enter a Vendor name before adding it.");
  if (name.length > MAX_VENDOR_NAME_LENGTH) {
    throw new Error(`Vendor name must be ${MAX_VENDOR_NAME_LENGTH} characters or fewer.`);
  }
  return { name, normalizedName: normalizeVendorName(name) };
}

export type VendorChoiceOption = { id: string; name: string };
export type VendorChoice =
  | { type: "new"; name: string }
  | { type: "existing"; vendor: VendorChoiceOption };

export function buildVendorChoices(vendors: VendorChoiceOption[], query: string) {
  const cleanedQuery = cleanVendorName(query);
  const normalizedQuery = normalizeVendorName(query);
  const exactVendor = normalizedQuery
    ? vendors.find((vendor) => normalizeVendorName(vendor.name) === normalizedQuery) ?? null
    : null;
  const filteredVendors = vendors.filter((vendor) =>
    normalizeVendorName(vendor.name).includes(normalizedQuery)
  );
  const canAdd = Boolean(cleanedQuery) && !exactVendor && cleanedQuery.length <= MAX_VENDOR_NAME_LENGTH;
  const choices: VendorChoice[] = [
    ...(canAdd ? [{ type: "new" as const, name: cleanedQuery }] : []),
    ...filteredVendors.map((vendor) => ({ type: "existing" as const, vendor })),
  ];
  return { cleanedQuery, exactVendor, filteredVendors, canAdd, choices };
}

export function resolveVendorSubmission(vendors: VendorChoiceOption[], query: string) {
  const { cleanedQuery, exactVendor } = buildVendorChoices(vendors, query);

  if (!cleanedQuery) {
    return { vendorId: "", newVendorName: "", vendorInput: "" };
  }

  if (exactVendor) {
    return {
      vendorId: exactVendor.id,
      newVendorName: "",
      vendorInput: exactVendor.name,
    };
  }

  return {
    vendorId: "",
    newVendorName: cleanedQuery,
    vendorInput: cleanedQuery,
  };
}
