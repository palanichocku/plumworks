import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DBF_PATH = "OriginalWinApp/Shopman32/data/laborfinal.DBF";
const FPT_PATH = "OriginalWinApp/Shopman32/data/laborfinal.FPT";
const decoder = new TextDecoder("windows-1252");

function parseFields(file, headerLength) {
  const fields = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) break;
    const descriptor = file.subarray(offset, offset + 32);
    const nameEnd = descriptor.indexOf(0);
    fields.push({
      name: decoder
        .decode(descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd))
        .trim(),
      type: String.fromCharCode(descriptor[11]),
      length: descriptor[16],
      recordOffset,
    });
    recordOffset += descriptor[16];
  }
  return fields;
}

function records(file, headerLength, recordLength, recordCount) {
  const result = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = file.subarray(start, start + recordLength);
    if (record.length === recordLength && record[0] !== 0x2a) result.push(record);
  }
  return result;
}

function numericSummary(values) {
  const nonZero = values.filter((value) => value > 0);
  return {
    zero: values.length - nonZero.length,
    nonZero: nonZero.length,
    distinct: new Set(nonZero).size,
    min: nonZero.length ? Math.min(...nonZero) : 0,
    max: nonZero.length ? Math.max(...nonZero) : 0,
  };
}

function isPlausibleText(bytes) {
  if (!bytes.length) return false;
  let meaningful = 0;
  let printable = 0;
  for (const byte of bytes) {
    if (byte === 0 || byte === 0x1a) continue;
    meaningful += 1;
    if (
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      (byte >= 32 && byte <= 126) ||
      byte >= 128
    ) {
      printable += 1;
    }
  }
  return meaningful >= 2 && printable / meaningful >= 0.85;
}

function trimMemo(bytes) {
  let end = bytes.length;
  while (end > 0 && [0, 0x1a, 0x20].includes(bytes[end - 1])) end -= 1;
  return bytes.subarray(0, end);
}

function evaluate({
  pointers,
  memoFile,
  pointerMode,
  offsetMode,
  blockSize,
  headerEndian,
  hasHeader,
}) {
  let inRange = 0;
  let plausible = 0;
  let empty = 0;
  let invalid = 0;
  let decodedLength = 0;

  for (const rawPointer of pointers) {
    let pointer;
    if (pointerMode === "le") pointer = rawPointer.readUInt32LE();
    else if (pointerMode === "be") pointer = rawPointer.readUInt32BE();
    else pointer = Number.parseInt(decoder.decode(rawPointer).trim(), 10) || 0;

    if (!pointer) {
      empty += 1;
      continue;
    }

    const offset = offsetMode === "block" ? pointer * blockSize : pointer;
    if (offset < 0 || offset >= memoFile.length) {
      invalid += 1;
      continue;
    }
    inRange += 1;

    let bytes;
    if (hasHeader) {
      if (offset + 8 > memoFile.length) {
        invalid += 1;
        continue;
      }
      const length =
        headerEndian === "be"
          ? memoFile.readUInt32BE(offset + 4)
          : memoFile.readUInt32LE(offset + 4);
      if (length > memoFile.length - offset - 8) {
        invalid += 1;
        continue;
      }
      bytes = trimMemo(memoFile.subarray(offset + 8, offset + 8 + length));
    } else {
      const end = Math.min(memoFile.length, offset + blockSize);
      bytes = trimMemo(memoFile.subarray(offset, end));
    }

    if (!bytes.length) empty += 1;
    else if (isPlausibleText(bytes)) {
      plausible += 1;
      decodedLength += bytes.length;
    } else invalid += 1;
  }

  return {
    inRange,
    plausible,
    empty,
    invalid,
    averageLength: plausible ? Math.round(decodedLength / plausible) : 0,
  };
}

function nonEmptyFieldCount(allRecords, field) {
  let count = 0;
  for (const record of allRecords) {
    const bytes = record.subarray(
      field.recordOffset,
      field.recordOffset + field.length,
    );
    if (["M", "G", "P"].includes(field.type)) {
      if (bytes.length >= 4 && bytes.readUInt32LE() > 0) count += 1;
    } else if (decoder.decode(bytes).trim()) count += 1;
  }
  return count;
}

function fieldIsNonEmpty(record, field) {
  const bytes = record.subarray(
    field.recordOffset,
    field.recordOffset + field.length,
  );
  if (["M", "G", "P"].includes(field.type)) {
    return bytes.length >= 4 && bytes.readUInt32LE() > 0;
  }
  return decoder.decode(bytes).trim().length > 0;
}

async function main() {
  const [dbfFile, memoFile] = await Promise.all([
    readFile(resolve(process.cwd(), DBF_PATH)),
    readFile(resolve(process.cwd(), FPT_PATH)),
  ]);
  const recordCount = dbfFile.readUInt32LE(4);
  const headerLength = dbfFile.readUInt16LE(8);
  const recordLength = dbfFile.readUInt16LE(10);
  const fields = parseFields(dbfFile, headerLength);
  const note = fields.find((field) => field.name === "NOTE");
  if (!note) throw new Error("NOTE field was not found.");
  const allRecords = records(dbfFile, headerLength, recordLength, recordCount);
  const pointerBytes = allRecords.map((record) =>
    record.subarray(note.recordOffset, note.recordOffset + note.length),
  );

  const le = numericSummary(pointerBytes.map((value) => value.readUInt32LE()));
  const be = numericSummary(pointerBytes.map((value) => value.readUInt32BE()));
  const ascii = numericSummary(
    pointerBytes.map(
      (value) => Number.parseInt(decoder.decode(value).trim(), 10) || 0,
    ),
  );
  const detectedBlockSizeBe = memoFile.readUInt16BE(6);
  const detectedBlockSizeLe = memoFile.readUInt16LE(6);

  console.log(`NOTE DBF type: ${note.type}`);
  console.log(`NOTE DBF length: ${note.length}`);
  for (const [name, summary] of [
    ["little-endian", le],
    ["big-endian", be],
    ["ASCII decimal", ascii],
  ]) {
    console.log(
      `${name} pointers: zero=${summary.zero}, non-zero=${summary.nonZero}, distinct=${summary.distinct}, min=${summary.min}, max=${summary.max}`,
    );
  }

  console.log(`FPT file size: ${memoFile.length}`);
  console.log(`FPT header first 16 bytes: ${memoFile.subarray(0, 16).toString("hex")}`);
  console.log(`FPT next-free-block big-endian: ${memoFile.readUInt32BE(0)}`);
  console.log(`FPT next-free-block little-endian: ${memoFile.readUInt32LE(0)}`);
  console.log(`FPT block size big-endian: ${detectedBlockSizeBe}`);
  console.log(`FPT block size little-endian: ${detectedBlockSizeLe}`);

  const sizes = [...new Set([detectedBlockSizeBe, 64, 512, 1024])].filter(
    (size) => size > 0,
  );
  for (const pointerMode of ["le", "be", "ascii"]) {
    for (const offsetMode of ["block", "byte-offset"]) {
      for (const blockSize of sizes) {
        for (const headerEndian of ["be", "le"]) {
          for (const hasHeader of [true, false]) {
            const result = evaluate({
              pointers: pointerBytes,
              memoFile,
              pointerMode,
              offsetMode,
              blockSize,
              headerEndian,
              hasHeader,
            });
            console.log(
              `approach pointer=${pointerMode}, offset=${offsetMode}, block=${blockSize}, header=${hasHeader ? `8-${headerEndian}` : "none"}: in-range=${result.inRange}, plausible=${result.plausible}, empty=${result.empty}, invalid=${result.invalid}, avg-length=${result.averageLength}`,
            );
          }
        }
      }
    }
  }

  for (const name of [
    "NOTE",
    "JOBDESC",
    "CODE",
    "OPCODE",
    "LABOR_DONE",
    "LABOR",
    "TYPE",
  ]) {
    const field = fields.find((candidate) => candidate.name === name);
    if (field) {
      console.log(
        `candidate field ${name}: type=${field.type}, length=${field.length}, non-empty=${nonEmptyFieldCount(allRecords, field)}`,
      );
    }
  }

  const priority = ["LABOR_DONE", "NOTE", "JOBDESC", "CODE"]
    .map((name) => fields.find((field) => field.name === name))
    .filter(Boolean);
  const selectedCounts = Object.fromEntries(
    priority.map((field) => [field.name, 0]),
  );
  let noDescriptionCandidate = 0;
  for (const record of allRecords) {
    const selected = priority.find((field) => fieldIsNonEmpty(record, field));
    if (selected) selectedCounts[selected.name] += 1;
    else noDescriptionCandidate += 1;
  }
  for (const field of priority) {
    console.log(
      `priority candidate ${field.name} selected count: ${selectedCounts[field.name]}`,
    );
  }
  console.log(`no description candidate count: ${noDescriptionCandidate}`);
}

await main();
