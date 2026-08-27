import type { WorkOrderContext } from "../../domain/work-orders.ts";

export type AutomotiveWorkOrderSource = Readonly<{
  id: string;
  repairOrderNumber?: number | null;
  legacyRoNo?: string | null;
  legacySourceTable?: string | null;
  status: string;
  customerId: string;
  vehicleId: string;
  openedAt: Date;
}>;

export function automotiveWorkOrderDisplayNumber(order: Pick<AutomotiveWorkOrderSource, "repairOrderNumber" | "legacyRoNo">) {
  const legacyNumber = order.legacyRoNo?.trim();
  return String((order.repairOrderNumber ?? legacyNumber) || "Not recorded");
}

export function automotiveWorkOrderHref(order: Pick<AutomotiveWorkOrderSource, "id" | "legacySourceTable">) {
  return order.legacySourceTable ? `/open-orders/${order.id}` : `/repair-orders/${order.id}`;
}

export function toAutomotiveWorkOrderContext(order: AutomotiveWorkOrderSource): WorkOrderContext {
  return {
    id: order.id,
    number: automotiveWorkOrderDisplayNumber(order),
    status: order.status,
    customerId: order.customerId,
    assetId: order.vehicleId,
    openedAt: order.openedAt,
    href: automotiveWorkOrderHref(order),
  };
}
