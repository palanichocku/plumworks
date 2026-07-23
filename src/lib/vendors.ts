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
