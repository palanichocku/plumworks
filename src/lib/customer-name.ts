export type CustomerNameSource = {
  displayName: string;
  legacyCustno?: string | null;
  legacySourceTable?: string | null;
};

export function customerDisplayName(firstName: string, lastName: string) {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

export function customerNameParts(customer: CustomerNameSource) {
  const displayName = customer.displayName.trim();
  if (!displayName) return { firstName: "", lastName: "" };

  // Imported Shopman customers historically contain a single legacy name value.
  // Preserve it exactly as the last-name value instead of guessing how to split it.
  if (customer.legacyCustno || customer.legacySourceTable) {
    return { firstName: "", lastName: displayName };
  }

  const separator = displayName.indexOf(" ");
  if (separator < 0) return { firstName: "", lastName: displayName };

  return {
    firstName: displayName.slice(0, separator).trim(),
    lastName: displayName.slice(separator + 1).trim(),
  };
}
