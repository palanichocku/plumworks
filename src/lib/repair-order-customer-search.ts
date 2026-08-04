export const REPAIR_ORDER_CUSTOMER_SEARCH_LIMIT = 10;
export const REPAIR_ORDER_CUSTOMER_SEARCH_MAX_LENGTH = 100;

export function normalizeRepairOrderCustomerQuery(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, REPAIR_ORDER_CUSTOMER_SEARCH_MAX_LENGTH)
    : "";
}
