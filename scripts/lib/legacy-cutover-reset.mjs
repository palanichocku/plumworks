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

// These tables are migration-managed and intentionally absent from Prisma models.
// They must be deleted in FK dependency order before the operational documents
// they describe are replaced from the authoritative Windows snapshot.
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
  const [signatureEvidence, authorizationEvents, authorizationRequests, documentRevisions] = await Promise.all([
    database.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM public.signature_evidence WHERE shop_id = $1::uuid", shopId),
    database.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM public.authorization_events WHERE shop_id = $1::uuid", shopId),
    database.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM public.authorization_requests WHERE shop_id = $1::uuid", shopId),
    database.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM public.document_revisions WHERE shop_id = $1::uuid", shopId),
  ]);
  return {
    signature_evidence: signatureEvidence[0]?.count ?? 0,
    authorization_events: authorizationEvents[0]?.count ?? 0,
    authorization_requests: authorizationRequests[0]?.count ?? 0,
    document_revisions: documentRevisions[0]?.count ?? 0,
  };
}

async function deleteMigrationManagedOperationalData(transaction, shopId) {
  // Keep these statements explicit. Dynamic table-name interpolation would make
  // this destructive path harder to audit and could introduce SQL-injection risk.
  await transaction.$executeRawUnsafe("DELETE FROM public.signature_evidence WHERE shop_id = $1::uuid", shopId);
  await transaction.$executeRawUnsafe("DELETE FROM public.authorization_events WHERE shop_id = $1::uuid", shopId);
  await transaction.$executeRawUnsafe("DELETE FROM public.authorization_requests WHERE shop_id = $1::uuid", shopId);
  await transaction.$executeRawUnsafe("DELETE FROM public.document_revisions WHERE shop_id = $1::uuid", shopId);
}

export async function deleteOperationalData(transaction, shopId) {
  await deleteMigrationManagedOperationalData(transaction, shopId);
  await transaction.auditLog.deleteMany({
    where: { shopId, entityType: { in: OPERATIONAL_AUDIT_TYPES } },
  });
  for (const [, model] of OPERATIONAL_MODELS) {
    await transaction[model].deleteMany({ where: { shopId } });
  }
}
