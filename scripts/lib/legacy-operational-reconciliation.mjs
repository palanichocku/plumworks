function textValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const value = rawData[field];
  return typeof value === "string" ? value.trim() || null : null;
}

function groupFirstByRo(rows) {
  const groups = new Map();
  for (const row of rows) {
    const ro = row.legacyRoNo?.trim();
    if (ro && !groups.has(ro)) groups.set(ro, row);
  }
  return groups;
}

export function reconcileInvoiceRows({ finalRows, laborRows, arRows, customerIds, vehicleIds }) {
  const invoiceGroups = groupFirstByRo(finalRows);
  const validInvoices = new Map();
  let missingCustomerLink = 0;
  let missingVehicleLink = 0;
  for (const [ro, row] of invoiceGroups) {
    if (!row.legacyCustno || !customerIds.has(row.legacyCustno)) {
      missingCustomerLink += 1;
      continue;
    }
    if (!row.legacyCarno || !vehicleIds.has(row.legacyCarno)) missingVehicleLink += 1;
    validInvoices.set(ro, row);
  }

  const parts = finalRows.filter((row) =>
    row.legacyRoNo && validInvoices.has(row.legacyRoNo) &&
    (textValue(row.rawData, "PARTNO") || textValue(row.rawData, "DESC")),
  );
  const labor = laborRows.filter((row) => row.legacyRoNo && validInvoices.has(row.legacyRoNo));
  const arGroups = groupFirstByRo(arRows);
  const ar = [...arGroups.entries()].filter(([ro, row]) =>
    validInvoices.has(ro) && Boolean(row.legacyCustno && customerIds.has(row.legacyCustno)),
  );

  return {
    invoices: validInvoices.size,
    parts: parts.length,
    labor: labor.length,
    ar: ar.length,
    reasons: {
      invoiceBlankRo: finalRows.filter((row) => !row.legacyRoNo).length,
      invoiceAdditionalRows: finalRows.length - invoiceGroups.size,
      invoiceMissingCustomer: missingCustomerLink,
      invoiceMissingVehicle: missingVehicleLink,
      partBlankDescription: finalRows.filter((row) => row.legacyRoNo && validInvoices.has(row.legacyRoNo) && !textValue(row.rawData, "PARTNO") && !textValue(row.rawData, "DESC")).length,
      partMissingInvoice: finalRows.filter((row) => !row.legacyRoNo || !validInvoices.has(row.legacyRoNo)).length,
      laborMissingInvoice: laborRows.length - labor.length,
      arBlankRo: arRows.filter((row) => !row.legacyRoNo).length,
      arAdditionalRows: arRows.length - arGroups.size,
      arMissingInvoiceOrCustomer: arGroups.size - ar.length,
    },
  };
}

export function reconcileOpenOrderRows({ partRows, laborRows, customerIds, vehicleIds }) {
  const groups = new Map();
  for (const [kind, rows] of [["parts", partRows], ["labor", laborRows]]) {
    for (const row of rows) {
      const ro = row.legacyRoNo?.trim();
      if (!ro) continue;
      const group = groups.get(ro) ?? { parts: [], labor: [] };
      group[kind].push(row);
      groups.set(ro, group);
    }
  }
  let validOrders = 0;
  let validParts = 0;
  let validLabor = 0;
  let missingCustomerLink = 0;
  let missingVehicleLink = 0;
  for (const group of groups.values()) {
    const header = group.parts[0] ?? group.labor[0];
    const legacyCustno = header.legacyCustno ?? group.labor.find((row) => row.legacyCustno)?.legacyCustno;
    const legacyCarno = header.legacyCarno ?? group.labor.find((row) => row.legacyCarno)?.legacyCarno;
    const hasCustomer = Boolean(legacyCustno && customerIds.has(legacyCustno));
    const hasVehicle = Boolean(legacyCarno && vehicleIds.has(legacyCarno));
    if (!hasCustomer) missingCustomerLink += 1;
    if (!hasVehicle) missingVehicleLink += 1;
    if (hasCustomer && hasVehicle) {
      validOrders += 1;
      validParts += group.parts.length;
      validLabor += group.labor.length;
    }
  }
  return {
    orders: validOrders,
    parts: validParts,
    labor: validLabor,
    reasons: {
      blankRoRows: partRows.filter((row) => !row.legacyRoNo).length + laborRows.filter((row) => !row.legacyRoNo).length,
      additionalRows: partRows.length + laborRows.length - groups.size,
      missingCustomerLink,
      missingVehicleLink,
      invalidOrderGroups: groups.size - validOrders,
    },
  };
}
