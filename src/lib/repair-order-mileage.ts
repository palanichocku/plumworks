export function repairOrderMileageForStorage(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const mileage = Number(text);
  return Number.isInteger(mileage) && mileage > 0 && mileage <= 10_000_000 ? mileage : undefined;
}
