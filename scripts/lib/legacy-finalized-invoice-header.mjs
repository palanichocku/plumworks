import { readFile } from "node:fs/promises";

const decoder = new TextDecoder("windows-1252");
export const FINALIZED_INVOICE_HEADER_KEY = "__finalsoldHeader";

function fields(file, headerLength) {
  const result = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) break;
    const descriptor = file.subarray(offset, offset + 32);
    const nameEnd = descriptor.indexOf(0);
    const name = decoder.decode(descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd)).trim();
    const type = String.fromCharCode(descriptor[11]);
    const length = descriptor[16];
    result.push({ name, type, length, recordOffset });
    recordOffset += length;
  }
  return result;
}

function memo(value, memoFile) {
  if (value.length < 4) return null;
  const pointer = value.readUInt32LE();
  const blockSize = memoFile.readUInt16BE(6);
  const offset = pointer * blockSize;
  if (!pointer || !blockSize || offset + 8 > memoFile.length) return null;
  const blockType = memoFile.readUInt32BE(offset);
  const length = memoFile.readUInt32BE(offset + 4);
  if (blockType !== 1 || length > memoFile.length - offset - 8) return null;
  return decoder.decode(memoFile.subarray(offset + 8, offset + 8 + length)).replaceAll("\0", "").trim() || null;
}

export function readLegacyFinalizedInvoiceHeaders(dbfFile, memoFile) {
  const recordCount = dbfFile.readUInt32LE(4);
  const headerLength = dbfFile.readUInt16LE(8);
  const recordLength = dbfFile.readUInt16LE(10);
  const descriptors = fields(dbfFile, headerLength);
  const rows = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = dbfFile.subarray(start, start + recordLength);
    if (record.length !== recordLength || record[0] === 0x2a) continue;
    const rawData = {};
    for (const field of descriptors) {
      const value = record.subarray(field.recordOffset, field.recordOffset + field.length);
      if (field.type === "0") continue;
      rawData[field.name] = field.type === "M"
        ? memo(value, memoFile)
        : decoder.decode(value).trim() || null;
    }
    const legacyRoNo = rawData.RO_NO?.trim() || null;
    if (legacyRoNo) rows.push({
      legacyRoNo,
      legacyCustno: rawData.CUSTNO?.trim() || null,
      legacyCarno: rawData.CARNO?.trim() || null,
      rawData,
    });
  }
  return rows;
}

export async function loadLegacyFinalizedInvoiceHeaders(source) {
  const [dbfFile, memoFile] = await Promise.all([
    readFile(source.files["finalsold.DBF"]),
    readFile(source.files["finalsold.FPT"]),
  ]);
  return readLegacyFinalizedInvoiceHeaders(dbfFile, memoFile);
}

function normalized(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

function identityValues(rows, field) {
  return new Set(rows.map((row) => normalized(row[field] ?? row.rawData?.[field])).filter(Boolean));
}

export function attachFinalizedInvoiceHeaders(rawAr, headers) {
  const headerGroups = new Map();
  for (const header of headers) {
    const group = headerGroups.get(header.legacyRoNo) ?? [];
    group.push(header);
    headerGroups.set(header.legacyRoNo, group);
  }
  const fatalIssues = [];
  const headerByRo = new Map();
  let duplicateEquivalent = 0;
  for (const [legacyRoNo, rows] of headerGroups) {
    const signatures = new Set(rows.map((row) => JSON.stringify([
      normalized(row.legacyCustno), normalized(row.legacyCarno), normalized(row.rawData?.DATE_SOLD),
      normalized(row.rawData?.VNOTES), normalized(row.rawData?.RECOMEND),
    ])));
    if (signatures.size > 1) {
      fatalIssues.push({ code: "conflicting-finalsold-headers", legacyRoNo });
      continue;
    }
    if (rows.length > 1) duplicateEquivalent += 1;
    headerByRo.set(legacyRoNo, rows[0]);
  }
  const arGroups = new Map();
  for (const row of rawAr) {
    const legacyRoNo = row.legacyRoNo?.trim();
    if (!legacyRoNo) continue;
    const group = arGroups.get(legacyRoNo) ?? [];
    group.push(row);
    arGroups.set(legacyRoNo, group);
  }
  for (const [legacyRoNo, arRows] of arGroups) {
    const header = headerByRo.get(legacyRoNo);
    if (!header) continue;
    for (const field of ["CUSTNO", "CARNO", "DATE_SOLD"]) {
      const arValues = identityValues(arRows, field);
      const headerValues = identityValues([header], field);
      if (arValues.size && headerValues.size &&
          (arValues.size !== headerValues.size || [...arValues].some((value) => !headerValues.has(value)))) {
        fatalIssues.push({ code: `finalsold-${field.toLowerCase()}-mismatch`, legacyRoNo });
      }
    }
  }
  const blocked = new Set(fatalIssues.map((issue) => issue.legacyRoNo));
  const rows = rawAr.map((row) => {
    const legacyRoNo = row.legacyRoNo?.trim();
    const header = legacyRoNo && !blocked.has(legacyRoNo) ? headerByRo.get(legacyRoNo) : null;
    if (!header) return row;
    return {
      ...row,
      rawData: {
        ...row.rawData,
        [FINALIZED_INVOICE_HEADER_KEY]: {
          customerComplaint: normalized(header.rawData?.VNOTES),
          recommendation: normalized(header.rawData?.RECOMEND),
        },
      },
    };
  });
  return {
    rows,
    fatalIssues,
    counts: {
      headers: headers.length,
      distinctHeaders: headerGroups.size,
      duplicateEquivalent,
      missingForAr: [...arGroups.keys()].filter((legacyRoNo) => !headerGroups.has(legacyRoNo)).length,
      headersWithoutAr: [...headerGroups.keys()].filter((legacyRoNo) => !arGroups.has(legacyRoNo)).length,
      customerComplaint: rows.filter((row) => finalizedInvoiceHeaderValues(row).customerComplaint).length,
      recommendation: rows.filter((row) => finalizedInvoiceHeaderValues(row).recommendation).length,
    },
  };
}

export function finalizedInvoiceHeaderValues(arRow) {
  const header = arRow?.rawData?.[FINALIZED_INVOICE_HEADER_KEY];
  return {
    customerComplaint: normalized(header?.customerComplaint),
    recommendation: normalized(header?.recommendation),
  };
}
