export type CustomerNameSource = {
  displayName: string;
  firstName?: string | null;
  legacyCustno?: string | null;
  legacySourceTable?: string | null;
};

export function customerDisplayName(firstName: string, lastName: string) {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

export function customerNameParts(customer: CustomerNameSource) {
  const displayName = customer.displayName.trim();
  if (!displayName) return { firstName: "", lastName: "" };

  const storedFirstName = customer.firstName?.trim() ?? "";
  if (storedFirstName) {
    const prefix = `${storedFirstName} `;
    if (displayName.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
      return {
        firstName: storedFirstName,
        lastName: displayName.slice(prefix.length).trim(),
      };
    }

    return { firstName: storedFirstName, lastName: displayName };
  }

  // Imported Shopman customers historically contain a single legacy name value.
  // Preserve it exactly as the last-name value until a real first name is saved.
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
