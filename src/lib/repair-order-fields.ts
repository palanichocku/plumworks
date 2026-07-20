export function optionalRepairOrderText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value : "";
  return text.trim() ? text : null;
}
