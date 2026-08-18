const PHONE_CHARACTERS = /^[\d\s()+.-]*$/;
const EMAIL = /^\S+@\S+\.\S+$/;
const decoder = new TextDecoder("windows-1252");

export function legacyCustomerMemo(value, memoFile) {
  if (!memoFile || value.length < 4) return null;
  const pointer = value.readUInt32LE();
  const blockSize = memoFile.readUInt16BE(6);
  const offset = pointer * blockSize;
  if (!pointer || !blockSize || offset + 8 > memoFile.length) return null;
  const blockType = memoFile.readUInt32BE(offset);
  const length = memoFile.readUInt32BE(offset + 4);
  if (blockType !== 1 || length > memoFile.length - offset - 8) return null;
  return decoder.decode(memoFile.subarray(offset + 8, offset + 8 + length)).replaceAll("\0", "").trim() || null;
}

export function legacyPhone(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { value: null, issue: null };
  if (!PHONE_CHARACTERS.test(text)) return { value: null, issue: "invalid-phone-characters" };
  let digits = text.replaceAll(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return { value: null, issue: "invalid-phone-length" };
  return { value: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, issue: null };
}

export function legacyEmail(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return { value: null, issue: null };
  return EMAIL.test(text) ? { value: text, issue: null } : { value: null, issue: "invalid-email" };
}

export function planLegacyCustomerContactBackfill({ sources, customers, aliases = [] }) {
  const fields = ["displayName", "phone", "phone2", "email", "addressLine1", "addressLine2", "city", "state", "postalCode", "notes", "message"];
  const customerByLegacy = new Map(customers.filter((row) => row.legacyCustno).map((row) => [row.legacyCustno, row]));
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const aliasByLegacy = new Map(aliases.map((row) => [row.aliasLegacyCustno, customerById.get(row.customerId)]));
  const grouped = new Map();
  for (const source of sources) grouped.set(source.legacyCustno, [...(grouped.get(source.legacyCustno) ?? []), source]);
  const counts = Object.fromEntries(fields.map((field) => [field, { proposedFill: 0, alreadyCurrent: 0, targetConflict: 0, sourceInvalid: 0, sourceAmbiguous: 0, noSourceValue: 0, aliasProtected: 0 }]));
  const updates = [];
  const comparable = (field, value) => field === "phone" || field === "phone2"
    ? legacyPhone(value).value ?? (typeof value === "string" ? value.trim() : "")
    : field === "email"
      ? legacyEmail(value).value ?? (typeof value === "string" ? value.trim().toLowerCase() : "")
      : typeof value === "string" ? value.trim() : "";
  for (const [legacyCustno, rows] of grouped) {
    const target = customerByLegacy.get(legacyCustno) ?? aliasByLegacy.get(legacyCustno);
    const aliasProtected = !customerByLegacy.has(legacyCustno) && aliasByLegacy.has(legacyCustno);
    if (!target) continue;
    const update = { customerId: target.id, legacyCustno, values: {} };
    for (const field of fields) {
      const values = [...new Set(rows.map((row) => row[field]).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
      const invalid = rows.some((row) => row.issues?.[field]);
      if (invalid) counts[field].sourceInvalid += 1;
      if (values.length > 1) { counts[field].sourceAmbiguous += 1; continue; }
      if (!values.length) { counts[field].noSourceValue += 1; continue; }
      const sourceValue = values[0];
      const targetValue = typeof target[field] === "string" ? target[field].trim() : "";
      if (comparable(field, targetValue) === comparable(field, sourceValue)) counts[field].alreadyCurrent += 1;
      else if (targetValue) counts[field].targetConflict += 1;
      else if (aliasProtected) counts[field].aliasProtected += 1;
      else { counts[field].proposedFill += 1; update.values[field] = sourceValue; }
    }
    if (Object.keys(update.values).length) updates.push(update);
  }
  return { counts, updates };
}
