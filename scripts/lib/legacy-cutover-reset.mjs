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

// Authorization/signature evidence is intentionally migration-managed rather
// than represented as Prisma models. It is regulatory evidence, so cutover must
// fail closed instead of silently deleting it. Any rows found here must be
// explicitly reviewed and dispositioned before Windows-authoritative reset.
export const MIGRATION_MANAGED_OPERATIONAL_TABLES = [
  "signature_evidence",
  "authorization_events",
  "authorization_requests",
  "document_revisions",
];

export const OPERATIONAL_AUDIT_TYPES = [
  "customer", "vehicle", "repair_order", "repair_order_part", "repair_order_labor",
  "invoice", "payment", "accounts_receivable",
];

export async function migrationManagedOperationalCounts(database, shopId) {
  const counts = {};
  for (const table of MIGRATION_MANAGED_OPERATIONAL_TABLES) {
    const rows = await database.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM public.${table} WHERE shop_id = $1::uuid`,
      shopId,
    );
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

export async function assertNoMigrationManagedOperationalEvidence(database, shopId) {
  const counts = await migrationManagedOperationalCounts(database, shopId);
  const populated = Object.entries(counts).filter(([, count]) => count > 0);
  if (populated.length) {
    const details = populated.map(([table, count]) => `${table}=${count}`).join(", ");
    throw new Error(`Cutover reset blocked: authorization/signature evidence exists (${details}). Review and disposition this evidence explicitly before Windows-authoritative replacement.`);
  }
  return counts;
}

export async function deleteOperationalData(transaction, shopId) {
  await assertNoMigrationManagedOperationalEvidence(transaction, shopId);
  await transaction.auditLog.deleteMany({
    where: { shopId, entityType: { in: OPERATIONAL_AUDIT_TYPES } },
  });
  for (const [, model] of OPERATIONAL_MODELS) {
    await transaction[model].deleteMany({ where: { shopId } });
  }
}
