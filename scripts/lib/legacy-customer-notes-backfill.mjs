import { createHash } from "node:crypto";
import { legacyCustomerMemo } from "./legacy-customer-contact.mjs";

export const LEGACY_CUSTOMER_NOTES_CONFIRMATION = "BACKFILL_LEGACY_CUSTOMER_NOTES";

const decoder = new TextDecoder("windows-1252");

function normalized(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

export function parseLegacyCustomerNotesBackfillArguments(args) {
  const valueOptions = new Set(["--shop-id", "--source-root", "--snapshot-manifest", "--database-fingerprint", "--evidence-output", "--confirm"]);
  const allowed = new Set([...valueOptions, "--dry-run"]);
  for (const item of args) if (item.startsWith("--") && !allowed.has(item)) throw new Error(`Unknown argument: ${item}`);
  const value = (name) => {
    const positions = args.flatMap((item, index) => item === name ? [index] : []);
    if (positions.length !== 1) throw new Error(`${name} must be provided exactly once.`);
    const result = args[positions[0] + 1];
    if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
    return result;
  };
  const shopId = value("--shop-id");
  const sourceRoot = value("--source-root");
  const snapshotManifest = value("--snapshot-manifest");
  const databaseFingerprint = value("--database-fingerprint");
  const optional = (name) => {
    const positions = args.flatMap((item, index) => item === name ? [index] : []);
    if (positions.length > 1) throw new Error(`${name} may be supplied only once.`);
    return positions.length ? value(name) : null;
  };
  const evidenceOutput = optional("--evidence-output");
  const confirmation = optional("--confirm");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shopId)) throw new Error("--shop-id must be a valid UUID.");
  if (!/^[0-9a-f]{64}$/.test(databaseFingerprint)) throw new Error("--database-fingerprint must be a SHA-256 value.");
  if (args.filter((item) => item === "--dry-run").length > 1) throw new Error("--dry-run may be supplied only once.");
  if (confirmation && confirmation !== LEGACY_CUSTOMER_NOTES_CONFIRMATION) throw new Error(`--confirm must equal ${LEGACY_CUSTOMER_NOTES_CONFIRMATION}.`);
  if (confirmation && args.includes("--dry-run")) throw new Error("--dry-run cannot be combined with confirmed writes.");
  if (confirmation && !evidenceOutput) throw new Error("Confirmed writes require --evidence-output.");
  return { shopId, sourceRoot, snapshotManifest, databaseFingerprint, evidenceOutput, dryRun: !confirmation };
}

function fieldsFromHeader(dbf) {
  const headerLength = dbf.readUInt16LE(8);
  const fields = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength && dbf[offset] !== 0x0d; offset += 32) {
    const descriptor = dbf.subarray(offset, offset + 32);
    const nameEnd = descriptor.indexOf(0);
    const name = decoder.decode(descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd)).trim();
    const length = descriptor[16];
    fields.push({ name, type: String.fromCharCode(descriptor[11]), length, recordOffset });
    recordOffset += length;
  }
  return fields;
}

export function readLegacyCustomerNoteSources(dbf, memo) {
  const recordCount = dbf.readUInt32LE(4);
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  const fields = fieldsFromHeader(dbf);
  const custno = fields.find((field) => field.name.toUpperCase() === "CUSTNO");
  const note = fields.find((field) => field.name.toUpperCase() === "NOTE" && field.type === "M");
  if (!custno || !note) throw new Error("Cust.DBF must contain CUSTNO and memo NOTE fields.");
  const sources = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = dbf.subarray(start, start + recordLength);
    if (record.length !== recordLength || record[0] === 0x2a) continue;
    const legacyCustno = normalized(decoder.decode(record.subarray(custno.recordOffset, custno.recordOffset + custno.length)));
    if (!legacyCustno) continue;
    const notes = legacyCustomerMemo(record.subarray(note.recordOffset, note.recordOffset + note.length), memo);
    sources.push({ legacyCustno, notes });
  }
  return sources;
}

export function planLegacyCustomerNotesBackfill({ sources, customers, aliases = [] }) {
  const sourceGroups = new Map();
  for (const source of sources) {
    const key = normalized(source.legacyCustno);
    if (!key) continue;
    sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), normalized(source.notes)]);
  }
  const aliasIds = new Set(aliases.map((alias) => normalized(alias.aliasLegacyCustno)).filter(Boolean));
  const proposals = [];
  const classifications = [];
  const ambiguousIds = new Set();
  for (const [legacyCustno, values] of sourceGroups) {
    if (values.length > 1) ambiguousIds.add(legacyCustno);
  }
  for (const customer of customers) {
    const legacyCustno = normalized(customer.legacyCustno);
    const values = legacyCustno ? sourceGroups.get(legacyCustno) : null;
    if (!legacyCustno || !values) {
      classifications.push({ code: "no-source-note", customerId: customer.id, legacyCustno });
      continue;
    }
    if (ambiguousIds.has(legacyCustno)) {
      classifications.push({ code: "source-ambiguous", customerId: customer.id, legacyCustno });
      continue;
    }
    const desiredNotes = values.find(Boolean) ?? null;
    if (!desiredNotes) {
      classifications.push({ code: "no-source-note", customerId: customer.id, legacyCustno });
      continue;
    }
    const currentNotes = normalized(customer.notes);
    if (currentNotes === desiredNotes) {
      classifications.push({ code: "already-current", customerId: customer.id, legacyCustno });
      continue;
    }
    if (currentNotes) {
      classifications.push({ code: "target-conflict", customerId: customer.id, legacyCustno });
      continue;
    }
    proposals.push({ id: customer.id, legacyCustno, beforeNotes: customer.notes ?? null, notes: desiredNotes });
    classifications.push({ code: "proposed-fill", customerId: customer.id, legacyCustno });
  }
  for (const legacyCustno of aliasIds) {
    if (sourceGroups.get(legacyCustno)?.some(Boolean)) classifications.push({ code: "alias-protected", customerId: null, legacyCustno });
  }
  const count = (code) => classifications.filter((item) => item.code === code).length;
  return {
    proposals, classifications,
    counts: {
      inspected: customers.length,
      proposedFills: proposals.length,
      multilineProposed: proposals.filter((proposal) => /[\r\n]/.test(proposal.notes)).length,
      alreadyCurrent: count("already-current"),
      targetConflicts: count("target-conflict"),
      sourceAmbiguities: count("source-ambiguous"),
      noSourceNote: count("no-source-note"),
      aliasProtected: count("alias-protected"),
    },
  };
}

export function canonicalCustomerNonNotesHash(customers) {
  const fields = ["id", "shopId", "displayName", "email", "phone", "phone2", "addressLine1", "addressLine2", "city", "state", "postalCode", "message", "legacyCustno", "legacySourceTable", "archivedAt", "createdAt", "updatedAt"];
  const rows = customers.map((customer) => Object.fromEntries(fields.map((field) => {
    const value = customer[field];
    return [field, value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value)];
  }))).sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export async function executeLegacyCustomerNotesBackfill({ transaction, shopId, proposals }) {
  let updated = 0;
  for (const proposal of proposals) {
    const rows = await transaction.$queryRawUnsafe(
      `UPDATE customers SET notes = $1::text
       WHERE id = $2::uuid AND shop_id = $3::uuid
         AND legacy_source_table = 'Cust.DBF'
         AND legacy_custno = $4::text
         AND notes IS NOT DISTINCT FROM $5::text
       RETURNING id`,
      proposal.notes, proposal.id, shopId, proposal.legacyCustno, proposal.beforeNotes,
    );
    if (rows.length !== 1) throw new Error("Concurrent Customer notes change detected; the entire backfill transaction was rolled back.");
    updated += 1;
  }
  return { updated };
}
