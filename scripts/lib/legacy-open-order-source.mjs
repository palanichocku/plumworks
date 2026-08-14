import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

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

function decode(value, type) {
  if (type === "0") return undefined;
  if (["C", "N", "F", "D"].includes(type)) return decoder.decode(value).trim() || null;
  if (type === "L") {
    const logical = decoder.decode(value).trim().toUpperCase();
    if (logical === "T" || logical === "Y") return true;
    if (logical === "F" || logical === "N") return false;
    return null;
  }
  if (type === "I" && value.length === 4) return value.readInt32LE();
  if (type === "B" && value.length === 8) {
    const number = value.readDoubleLE();
    return Number.isFinite(number) ? number : null;
  }
  if (["M", "G", "P"].includes(type)) {
    const pointer = value.length >= 4 ? value.readUInt32LE() : 0;
    return pointer ? { memoPointer: String(pointer) } : null;
  }
  return { hex: value.toString("hex") };
}

export function readActiveDbfRows(file) {
  const recordCount = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const descriptors = fields(file, headerLength);
  const rows = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = file.subarray(start, start + recordLength);
    if (record.length !== recordLength || record[0] === 0x2a) continue;
    const rawData = {};
    for (const field of descriptors) {
      const value = decode(record.subarray(field.recordOffset, field.recordOffset + field.length), field.type);
      if (value !== undefined) rawData[field.name] = value;
    }
    rows.push(rawData);
  }
  return rows;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function keyedOpenOrderRows(rows, sourceModel) {
  const occurrences = new Map();
  return rows.map((rawData) => {
    const hash = createHash("sha256").update(JSON.stringify(canonicalize(rawData))).digest("hex").slice(0, 24);
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    return { rawData, legacyRowKey: `${sourceModel}:${hash}:${occurrence}` };
  });
}

export async function loadOpenOrderSourceRows(source) {
  const [partFile, laborFile] = await Promise.all([
    readFile(source.files["orders.DBF"]),
    readFile(source.files["LABORorder.DBF"]),
  ]);
  return {
    partRows: keyedOpenOrderRows(readActiveDbfRows(partFile), "rawLegacyOrderPart"),
    laborRows: keyedOpenOrderRows(readActiveDbfRows(laborFile), "rawLegacyOrderLabor"),
  };
}
