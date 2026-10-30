import { open, readFile } from "node:fs/promises";

const decoder = new TextDecoder("windows-1252");

function fieldsFromHeader(file, headerLength) {
  const fields = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) break;
    const descriptor = file.subarray(offset, offset + 32);
    const nameEnd = descriptor.indexOf(0);
    const name = decoder.decode(descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd)).trim();
    fields.push({ name, type: String.fromCharCode(descriptor[11]), length: descriptor[16], recordOffset });
    recordOffset += descriptor[16];
  }
  return fields;
}

function value(bytes, type) {
  if (["C", "N", "F", "D", "L"].includes(type)) return decoder.decode(bytes).trim() || null;
  if (type === "I" && bytes.length === 4) return bytes.readInt32LE();
  return null;
}

function identifier(rawData, candidates) {
  const match = Object.entries(rawData).find(([key]) => candidates.includes(key.toUpperCase().replaceAll("_", "")));
  return match?.[1] == null ? null : String(match[1]).trim() || null;
}

export async function readLegacyDbf(path) {
  const file = await readFile(path);
  const recordCount = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const fields = fieldsFromHeader(file, headerLength);
  const rows = [];
  let deletedRows = 0;
  for (let index = 0; index < recordCount; index += 1) {
    const record = file.subarray(headerLength + index * recordLength, headerLength + (index + 1) * recordLength);
    if (record.length !== recordLength) throw new Error(`Truncated DBF record ${index + 1} in ${path}.`);
    if (record[0] === 0x2a) {
      deletedRows += 1;
      continue;
    }
    const rawData = {};
    for (const field of fields) rawData[field.name] = value(record.subarray(field.recordOffset, field.recordOffset + field.length), field.type);
    rows.push({
      rawData,
      legacyCustno: identifier(rawData, ["CUSTNO", "CUSTOMERNO"]),
      legacyCarno: identifier(rawData, ["CARNO", "VEHICLENO"]),
      legacyRoNo: identifier(rawData, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]),
    });
  }
  return { rows, deletedRows, recordCount };
}

export async function sourceFileRowCount(path) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(32);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) throw new Error(`Unable to read DBF header from ${path}.`);
    return header.readUInt32LE(4);
  } finally {
    await handle.close();
  }
}
