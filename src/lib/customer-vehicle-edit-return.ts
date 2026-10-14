const REPAIR_ORDER_RETURN_PATH = /^\/repair-orders\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function customerVehicleEditReturnPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  return REPAIR_ORDER_RETURN_PATH.test(path) ? path : null;
}
