function tally(rows, field) {
  return rows.filter((row) => row[field] !== null && row[field] !== undefined && row[field] !== "").length;
}

export function reconcileLegacyCustomerFields(sourceCustomers, destinationCustomers, { sourceAmbiguous = 0 } = {}) {
  const source = new Map();
  const destination = new Map();
  let ambiguous = sourceAmbiguous;
  for (const [rows, index] of [[sourceCustomers, source], [destinationCustomers, destination]]) {
    for (const row of rows) {
      if (!row.legacyCustno || index.has(row.legacyCustno)) ambiguous += 1;
      else index.set(row.legacyCustno, row);
    }
  }
  let unresolved = 0;
  let firstNameMismatches = 0;
  let noteMismatches = 0;
  for (const [legacyCustno, expected] of source) {
    const actual = destination.get(legacyCustno);
    if (!actual) unresolved += 1;
    if ((expected.firstName ?? null) !== (actual?.firstName ?? null) || !actual) firstNameMismatches += 1;
    if ((expected.notes ?? null) !== (actual?.notes ?? null) || !actual) noteMismatches += 1;
  }
  for (const legacyCustno of destination.keys()) if (!source.has(legacyCustno)) unresolved += 1;
  return {
    sourceCustomersWithFirstName: tally(sourceCustomers, "firstName"),
    destinationCustomersWithFirstName: tally(destinationCustomers, "firstName"),
    firstNameMismatches,
    sourceCustomersWithNotes: tally(sourceCustomers, "notes"),
    destinationCustomersWithNotes: tally(destinationCustomers, "notes"),
    noteMismatches,
    unresolved,
    ambiguous,
    blockingIssues: firstNameMismatches + noteMismatches + unresolved + ambiguous,
  };
}
