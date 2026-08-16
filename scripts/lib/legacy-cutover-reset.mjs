export const OPERATIONAL_MODELS = [
  ["payments", "payment"],
  ["accounts_receivable", "accountReceivable"],
  ["invoice_parts", "invoicePart"],
  ["invoice_labor", "invoiceLabor"],
  ["invoices", "invoice"],
  ["repair_order_parts", "repairOrderPart"],
  ["repair_order_labor", "repairOrderLabor"],
  ["repair_orders", "repairOrder"],
  ["vehicles", "vehicle"],
  ["customer_legacy_aliases", "customerLegacyAlias"],
  ["customers", "customer"],
  ["legacy_import_errors", "legacyImportError"],
  ["raw_legacy_customers", "rawLegacyCustomer"],
  ["raw_legacy_vehicles", "rawLegacyVehicle"],
  ["raw_legacy_final", "rawLegacyFinal"],
  ["raw_legacy_labor_final", "rawLegacyLaborFinal"],
  ["raw_legacy_ar", "rawLegacyAr"],
  ["raw_legacy_order_parts", "rawLegacyOrderPart"],
  ["raw_legacy_order_labor", "rawLegacyOrderLabor"],
  ["legacy_import_runs", "legacyImportRun"],
];

export const OPERATIONAL_AUDIT_TYPES = [
  "customer", "vehicle", "repair_order", "repair_order_part", "repair_order_labor",
  "invoice", "payment", "accounts_receivable",
];

export async function deleteOperationalData(transaction, shopId) {
  await transaction.auditLog.deleteMany({
    where: { shopId, entityType: { in: OPERATIONAL_AUDIT_TYPES } },
  });
  for (const [, model] of OPERATIONAL_MODELS) {
    await transaction[model].deleteMany({ where: { shopId } });
  }
}
