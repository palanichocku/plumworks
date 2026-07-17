import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

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
    const name = decoder
      .decode(descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd))
      .trim();
    const type = String.fromCharCode(descriptor[11]);
    const length = descriptor[16];
    fields.push({ name, type, length, recordOffset });
    recordOffset += length;
  }
  return fields;
}

function decodeMemo(value, memoFile) {
  if (value.length < 4) return null;
  const pointer = value.readUInt32LE();
  if (!pointer) return null;
  const blockSize = memoFile.readUInt16BE(6);
  const offset = pointer * blockSize;
  if (!blockSize || offset + 8 > memoFile.length) return null;
  const blockType = memoFile.readUInt32BE(offset);
  const length = memoFile.readUInt32BE(offset + 4);
  if (blockType !== 1 || length > memoFile.length - offset - 8) return null;
  return decoder
    .decode(memoFile.subarray(offset + 8, offset + 8 + length))
    .replaceAll("\0", "")
    .trim() || null;
}

function decodeField(value, type, memoFile) {
  if (type === "0") return undefined;
  if (["C", "N", "F", "D"].includes(type)) {
    return decoder.decode(value).trim() || null;
  }
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
  if (["M", "G", "P"].includes(type)) return decodeMemo(value, memoFile);
  return { hex: value.toString("hex") };
}

function readLaborRows(dbfFile, memoFile) {
  const recordCount = dbfFile.readUInt32LE(4);
  const headerLength = dbfFile.readUInt16LE(8);
  const recordLength = dbfFile.readUInt16LE(10);
  const fields = parseFields(dbfFile, headerLength);
  const rows = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = dbfFile.subarray(start, start + recordLength);
    if (record.length !== recordLength || record[0] === 0x2a) continue;
    const rawData = {};
    for (const field of fields) {
      const value = record.subarray(
        field.recordOffset,
        field.recordOffset + field.length,
      );
      const decoded = decodeField(value, field.type, memoFile);
      if (decoded !== undefined) rawData[field.name] = decoded;
    }
    rows.push(rawData);
  }
  return rows;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function withoutNote(rawData) {
  return Object.fromEntries(
    Object.entries(rawData).filter(([field]) => field !== "NOTE"),
  );
}

function signature(rawData) {
  return JSON.stringify(canonicalize(withoutNote(rawData)));
}

function hash(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")
    .slice(0, 24);
}

function textValue(rawData, field) {
  const value = rawData[field];
  return typeof value === "string" ? value.trim() || null : null;
}

function roNumber(rawData) {
  return textValue(rawData, "RO_NO") ?? textValue(rawData, "RONO");
}

function chunks(items, size = 200) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  const [dbfFile, memoFile] = await Promise.all([
    readFile(resolve(process.cwd(), DBF_PATH)),
    readFile(resolve(process.cwd(), FPT_PATH)),
  ]);
  const sourceRows = readLaborRows(dbfFile, memoFile);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const shopId = await resolveSingleShopId(prisma);
    const latest = await prisma.rawLegacyLaborFinal.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      select: { legacyImportRunId: true },
    });
    if (!latest) throw new Error("No staged labor import run was found.");

    const [rawRows, cleanRows] = await Promise.all([
      prisma.rawLegacyLaborFinal.findMany({
        where: {
          shopId,
          legacyImportRunId: latest.legacyImportRunId,
        },
        select: { id: true, legacyRoNo: true, rawData: true },
      }),
      prisma.invoiceLabor.findMany({
        where: { shopId },
        select: { id: true, legacyLineKey: true },
      }),
    ]);

    const rawBySignature = new Map();
    for (const row of rawRows) {
      const key = signature(row.rawData);
      const matches = rawBySignature.get(key) ?? [];
      matches.push(row);
      rawBySignature.set(key, matches);
    }

    const cleanByKey = new Map(cleanRows.map((row) => [row.legacyLineKey, row]));
    const cleanByOldPrefix = new Map();
    for (const row of cleanRows) {
      const lastSeparator = row.legacyLineKey.lastIndexOf(":");
      const prefix = row.legacyLineKey.slice(0, lastSeparator + 1);
      const matches = cleanByOldPrefix.get(prefix) ?? [];
      matches.push(row);
      cleanByOldPrefix.set(prefix, matches);
    }

    const occurrences = new Map();
    const rawUpdates = [];
    const cleanUpdates = [];
    for (const rawData of sourceRows) {
      const stagedMatches = rawBySignature.get(signature(rawData));
      const staged = stagedMatches?.shift();
      if (!staged) continue;
      rawUpdates.push({ id: staged.id, rawData });

      const ro = roNumber(rawData);
      if (!ro) continue;
      const identityHash = hash(withoutNote(rawData));
      const occurrenceKey = `${ro}:${identityHash}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      const targetKey = `laborfinal:${ro}:${identityHash}:${occurrence}`;
      let clean = cleanByKey.get(targetKey);

      if (!clean) {
        const oldHash = createHash("sha256")
          .update(JSON.stringify(staged.rawData))
          .digest("hex")
          .slice(0, 24);
        const oldPrefix = `laborfinal:${ro}:${oldHash}:`;
        clean = cleanByOldPrefix.get(oldPrefix)?.shift();
      }
      if (!clean) continue;

      const description =
        textValue(rawData, "NOTE") ??
        textValue(rawData, "JOBDESC") ??
        textValue(rawData, "CODE") ??
        "Legacy labor";
      cleanUpdates.push({ id: clean.id, description, targetKey });
    }

    if (process.argv.includes("--dry-run")) {
      console.log(`raw labor rows to restage: ${rawUpdates.length}`);
      console.log(`clean labor rows to update: ${cleanUpdates.length}`);
      return;
    }

    for (const batch of chunks(rawUpdates)) {
      const values = batch
        .map((_, index) => `($${index * 2 + 1}::uuid, $${index * 2 + 2}::jsonb)`)
        .join(", ");
      await prisma.$executeRawUnsafe(
        `UPDATE raw_legacy_labor_final AS target SET raw_data = source.raw_data FROM (VALUES ${values}) AS source(id, raw_data) WHERE target.id = source.id`,
        ...batch.flatMap((row) => [row.id, JSON.stringify(row.rawData)]),
      );
    }

    for (const batch of chunks(cleanUpdates)) {
      const values = batch
        .map(
          (_, index) =>
            `($${index * 3 + 1}::uuid, $${index * 3 + 2}::text, $${index * 3 + 3}::text)`,
        )
        .join(", ");
      await prisma.$executeRawUnsafe(
        `UPDATE invoice_labor AS target SET description = source.description, legacy_line_key = source.legacy_line_key, updated_at = now() FROM (VALUES ${values}) AS source(id, description, legacy_line_key) WHERE target.id = source.id`,
        ...batch.flatMap((row) => [row.id, row.description, row.targetKey]),
      );
    }

    console.log(`raw labor rows restaged: ${rawUpdates.length}`);
    console.log(`clean labor rows updated: ${cleanUpdates.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
