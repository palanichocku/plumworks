export const repairOrderLayouts = ["classic", "guided", "split"] as const;

export type RepairOrderLayout = (typeof repairOrderLayouts)[number];

export function canPreviewRepairOrderLayout(role: string | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function resolveRepairOrderLayout(
  role: string | null | undefined,
  requested: string | null | undefined,
): RepairOrderLayout {
  if (!canPreviewRepairOrderLayout(role)) return "classic";
  return repairOrderLayouts.includes(requested as RepairOrderLayout)
    ? requested as RepairOrderLayout
    : "classic";
}

export function optionalRepairOrderText(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
}
