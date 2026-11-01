export function configurationEvidence({ signatureDefaults, securitySettings }) {
  return {
    shopSignatureDefaults: signatureDefaults == null ? null : {
      representative_name: signatureDefaults.representative_name,
      signature_sha256: signatureDefaults.signature_sha256,
      updated_by: signatureDefaults.updated_by,
    },
    shopSecuritySettings: securitySettings == null ? null : {
      mfa_required: securitySettings.mfa_required,
    },
  };
}

const MAX_REPAIR_ORDER_NUMBER = 2_147_483_647;

function strictRepairOrderNumber(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_REPAIR_ORDER_NUMBER ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_REPAIR_ORDER_NUMBER ? parsed : null;
}

function validCounter(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_REPAIR_ORDER_NUMBER;
}

/**
 * Preserve the captured counter as a lower bound, then advance it above all
 * operational Repair Orders using the same max(counter, imported max + 1)
 * rule used by the final-cutover open-order projection.
 */
export function verifyRepairOrderSequence({ beforeCounter, repairOrders, actualCounter }) {
  const issues = [];
  if (!validCounter(beforeCounter)) issues.push("invalid-before-counter");
  if (!validCounter(actualCounter)) issues.push("invalid-actual-counter");
  if (!Array.isArray(repairOrders)) issues.push("invalid-repair-order-set");

  const rows = Array.isArray(repairOrders) ? repairOrders : [];
  const existingNumbers = new Set();
  let highestOperationalRONumber = 0;
  for (const row of rows) {
    if (row.repairOrderNumber !== null && row.repairOrderNumber !== undefined) {
      const parsedNumber = strictRepairOrderNumber(row.repairOrderNumber);
      if (parsedNumber === null) {
        issues.push("malformed-repair-order-number");
      } else {
        existingNumbers.add(parsedNumber);
      }
    }

    if (row.legacySourceTable !== null) continue;
    const number = strictRepairOrderNumber(row.repairOrderNumber);
    if (number === null) {
      issues.push("operational-repair-order-number-missing-or-malformed");
      continue;
    }
    if (row.legacyRoNo !== null && row.legacyRoNo !== undefined) {
      const legacyNumber = strictRepairOrderNumber(row.legacyRoNo);
      if (legacyNumber === null) issues.push("malformed-operational-legacy-ro-number");
      else if (legacyNumber !== number) issues.push("operational-ro-number-identity-mismatch");
    }
    highestOperationalRONumber = Math.max(highestOperationalRONumber, number);
  }

  const nextAfterHighest = highestOperationalRONumber + 1;
  if (nextAfterHighest > MAX_REPAIR_ORDER_NUMBER) issues.push("operational-repair-order-number-exhausted");
  const expectedValue = validCounter(beforeCounter) && nextAfterHighest <= MAX_REPAIR_ORDER_NUMBER
    ? Math.max(beforeCounter, nextAfterHighest)
    : null;
  if (expectedValue !== null && existingNumbers.has(expectedValue)) issues.push("next-counter-collides-with-existing-repair-order");
  if (validCounter(beforeCounter) && validCounter(actualCounter) && actualCounter < beforeCounter) {
    issues.push("counter-moved-backwards");
  }
  if (expectedValue !== null && validCounter(actualCounter) && actualCounter !== expectedValue) {
    issues.push(actualCounter < expectedValue ? "counter-below-expected" : "counter-above-expected");
  }

  return {
    pass: issues.length === 0,
    beforeValue: beforeCounter,
    highestOperationalRONumber: highestOperationalRONumber || null,
    expectedValue,
    actualValue: actualCounter,
    issues: [...new Set(issues)],
  };
}

export function preservedConfigurationDifferences(before, current) {
  const beforeShop = { ...before.shop };
  const currentShop = { ...current.shop };
  delete beforeShop.nextRepairOrderNumber;
  delete currentShop.nextRepairOrderNumber;
  const changed = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
    if (key === "capturedAt") continue;
    const beforeValue = key === "shop" ? beforeShop : before[key];
    const currentValue = key === "shop" ? currentShop : current[key];
    if (JSON.stringify(beforeValue) !== JSON.stringify(currentValue)) changed.push(key);
  }
  return changed;
}
