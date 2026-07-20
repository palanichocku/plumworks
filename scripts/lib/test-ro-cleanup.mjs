export function parseCleanupArguments(argv) {
  const result = { roNumber: null, confirmation: null, deleteOrphanCustomer: false, deleteOrphanVehicle: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
    seen.add(argument);
    if (argument === "--ro" || argument === "--confirm") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--ro") result.roNumber = Number(value);
      else result.confirmation = value;
      index += 1;
    } else if (argument === "--delete-orphan-customer") result.deleteOrphanCustomer = true;
    else if (argument === "--delete-orphan-vehicle") result.deleteOrphanVehicle = true;
    else if (argument === "--dry-run") { /* explicit dry-run is accepted */ }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isSafeInteger(result.roNumber) || result.roNumber <= 0) throw new Error("--ro must be a positive integer Repair Order number.");
  result.expectedConfirmation = `DELETE_TEST_RO_${result.roNumber}`;
  if (result.confirmation !== null && result.confirmation !== result.expectedConfirmation) throw new Error(`--confirm must equal ${result.expectedConfirmation}.`);
  result.dryRun = result.confirmation === null;
  return result;
}

export function legacyMarker(record) {
  if (!record) return null;
  for (const field of ["legacySourceTable", "legacyRoNo"]) {
    if (record[field]) return `${field}=${record[field]}`;
  }
  if (record.legacyLineKey && !record.legacyLineKey.startsWith("web:")) return `legacyLineKey=${record.legacyLineKey}`;
  return null;
}

export function requireSingleMatch(matches, roNumber) {
  if (matches.length === 0) throw new Error(`Repair Order ${roNumber} was not found.`);
  if (matches.length !== 1) throw new Error(`Repair Order ${roNumber} is ambiguous; found ${matches.length} rows.`);
  return matches[0];
}

export async function runConfirmedCleanup({ createBackup, transaction }) {
  const checkpoint = await createBackup();
  const result = await transaction();
  return { checkpoint, result };
}

export function assertApplicationCreatedGraph(graph) {
  const records = [
    ["Repair Order", graph.repairOrder],
    ...graph.repairOrder.parts.map((row) => ["Repair Order part", row]),
    ...graph.repairOrder.labor.map((row) => ["Repair Order labor", row]),
    ...(graph.invoice ? [
      ["Invoice", graph.invoice],
      ...graph.invoice.parts.map((row) => ["Invoice part", row]),
      ...graph.invoice.labor.map((row) => ["Invoice labor", row]),
      ...graph.invoice.payments.map((row) => ["Payment", row]),
      ...graph.invoice.accountsReceivable.map((row) => ["Accounts Receivable", row]),
      ...graph.invoice.legacyCharges.map((row) => ["Invoice legacy charge", row]),
    ] : []),
  ];
  const legacy = records.map(([label, record]) => ({ label, marker: legacyMarker(record) })).find(({ marker }) => marker);
  if (legacy) throw new Error(`Legacy protection refused deletion: ${legacy.label} has ${legacy.marker}.`);
}

export function orphanDecisions(graph, options) {
  const vehicleReasons = [];
  if (!options.deleteOrphanVehicle) vehicleReasons.push("--delete-orphan-vehicle was not supplied");
  if (graph.vehicle.legacySourceTable || graph.vehicle.legacyCarno) vehicleReasons.push("vehicle has legacy identity");
  if (graph.references.vehicleOtherRepairOrders) vehicleReasons.push(`${graph.references.vehicleOtherRepairOrders} other Repair Order reference(s)`);
  if (graph.references.vehicleOtherInvoices) vehicleReasons.push(`${graph.references.vehicleOtherInvoices} other Invoice reference(s)`);
  const deleteVehicle = Boolean(options.deleteOrphanVehicle && vehicleReasons.length === 0);

  const customerReasons = [];
  if (!options.deleteOrphanCustomer) customerReasons.push("--delete-orphan-customer was not supplied");
  if (graph.customer.legacySourceTable || graph.customer.legacyCustno) customerReasons.push("customer has legacy identity");
  if (graph.references.customerOtherRepairOrders) customerReasons.push(`${graph.references.customerOtherRepairOrders} other Repair Order reference(s)`);
  if (graph.references.customerOtherInvoices) customerReasons.push(`${graph.references.customerOtherInvoices} other Invoice reference(s)`);
  if (graph.references.customerOtherPayments) customerReasons.push(`${graph.references.customerOtherPayments} other Payment reference(s)`);
  if (graph.references.customerOtherReceivables) customerReasons.push(`${graph.references.customerOtherReceivables} other Accounts Receivable reference(s)`);
  if (graph.references.customerAliases) customerReasons.push(`${graph.references.customerAliases} legacy alias reference(s)`);
  const remainingVehicles = graph.references.customerVehicles - (deleteVehicle ? 1 : 0);
  if (remainingVehicles > 0) customerReasons.push(`${remainingVehicles} remaining Vehicle reference(s)`);
  const deleteCustomer = Boolean(options.deleteOrphanCustomer && customerReasons.length === 0);
  return { deleteVehicle, vehicleReasons, deleteCustomer, customerReasons };
}

export async function executeCleanup(transaction, graph, decisions) {
  const invoiceId = graph.invoice?.id;
  const deleted = {};
  if (invoiceId) {
    deleted.payments = (await transaction.payment.deleteMany({ where: { shopId: graph.shop.id, invoiceId } })).count;
    deleted.accountsReceivable = (await transaction.accountReceivable.deleteMany({ where: { shopId: graph.shop.id, invoiceId } })).count;
    deleted.invoiceLegacyCharges = (await transaction.invoiceLegacyCharge.deleteMany({ where: { invoiceId } })).count;
    deleted.invoiceParts = (await transaction.invoicePart.deleteMany({ where: { shopId: graph.shop.id, invoiceId } })).count;
    deleted.invoiceLabor = (await transaction.invoiceLabor.deleteMany({ where: { shopId: graph.shop.id, invoiceId } })).count;
    await transaction.invoice.delete({ where: { id: invoiceId } });
    deleted.invoices = 1;
  }
  deleted.repairOrderParts = (await transaction.repairOrderPart.deleteMany({ where: { shopId: graph.shop.id, repairOrderId: graph.repairOrder.id } })).count;
  deleted.repairOrderLabor = (await transaction.repairOrderLabor.deleteMany({ where: { shopId: graph.shop.id, repairOrderId: graph.repairOrder.id } })).count;
  await transaction.repairOrder.delete({ where: { id: graph.repairOrder.id } });
  deleted.repairOrders = 1;
  if (decisions.deleteVehicle) { await transaction.vehicle.delete({ where: { id: graph.vehicle.id } }); deleted.vehicles = 1; }
  if (decisions.deleteCustomer) { await transaction.customer.delete({ where: { id: graph.customer.id } }); deleted.customers = 1; }
  return deleted;
}
