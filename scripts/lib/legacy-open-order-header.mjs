import { readFile } from "node:fs/promises";
import { evidenceHash } from "./legacy-snapshot-evidence.mjs";

const decoder = new TextDecoder("windows-1252");

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

export function readLegacyOpenOrderHeaders(dbfFile, memoFile, includeEvidence = false) {
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
    const legacyRoNo = typeof rawData.RO_NO === "string" ? rawData.RO_NO.trim() || null : null;
    if (legacyRoNo) rows.push(includeEvidence ? {
      legacyRoNo,
      legacyCustno: typeof rawData.CUSTNO === "string" ? rawData.CUSTNO.trim() || null : null,
      legacyCarno: typeof rawData.CARNO === "string" ? rawData.CARNO.trim() || null : null,
      physicalRecordNumber: index + 1,
      deleted: false,
      rawData,
      evidenceSha256: evidenceHash(rawData),
      legacyRowKey: `rawLegacyOpenOrderHeader:${evidenceHash(rawData).slice(0, 24)}:1`,
    } : { legacyRoNo, rawData });
  }
  return rows;
}

export async function loadLegacyOpenOrderHeaders(source) {
  const [dbfFile, memoFile] = await Promise.all([
    readFile(source.files["ordtemps.DBF"]),
    readFile(source.files["ordtemps.FPT"]),
  ]);
  return readLegacyOpenOrderHeaders(dbfFile, memoFile, true);
}
