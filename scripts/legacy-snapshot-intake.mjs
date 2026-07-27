import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REQUIRED_LEGACY_FILES = Object.freeze([
  "Cust.DBF",
  "vehicles.DBF",
  "FINAL.DBF",
  "laborfinal.DBF",
  "laborfinal.FPT",
  "ar.DBF",
  "orders.DBF",
  "LABORorder.DBF",
]);

const DBF_FILES = REQUIRED_LEGACY_FILES.filter((name) => name.toLowerCase().endsWith(".dbf"));
const MAX_ENTRIES = 100_000;
const MAX_ENTRY_BYTES = 2 * 1024 ** 3;
const MAX_EXPANDED_BYTES = 4 * 1024 ** 3;
const MAX_COMPRESSION_RATIO = 200;
const RATIO_CHECK_MINIMUM_BYTES = 1024 ** 2;
const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_ENTRY = 0x02014b50;
const ZIP64_SENTINEL = 0xffffffff;
const UNIX_FILE_TYPE = 0o170000;
const UNIX_REGULAR = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;
const LEGACY_EXECUTABLE = "shopman32.exe";
const LEGACY_SUPPORT_ARTIFACTS = Object.freeze(["vfp8r.dll", "vfp8renu.dll", "config.fpw", "gdiplus.dll"]);

function valueFor(args, name) {
  const positions = args.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length !== 1) throw new Error(`${name} must be provided exactly once.`);
  const value = args[positions[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseSnapshotIntakeArguments(args) {
  const allowed = new Set(["--zip", "--snapshot-date", "--destination", "--dry-run"]);
  for (const value of args) {
    if (value.startsWith("--") && !allowed.has(value)) throw new Error(`Unknown argument: ${value}`);
  }
  if (args.filter((value) => value === "--dry-run").length > 1) throw new Error("--dry-run may be provided only once.");
  const zip = valueFor(args, "--zip");
  const snapshotDate = valueFor(args, "--snapshot-date");
  const destination = valueFor(args, "--destination");
  if (!SNAPSHOT_DATE.test(snapshotDate)) throw new Error("--snapshot-date must use YYYY-MM-DD.");
  const parsedDate = new Date(`${snapshotDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== snapshotDate) {
    throw new Error("--snapshot-date is not a valid calendar date.");
  }
  return { zip, snapshotDate, destination, dryRun: args.includes("--dry-run") };
}

function normalizedArchivePath(name) {
  if (!name || name.includes("\0")) throw new Error("ZIP contains an empty or invalid entry name.");
  const slashes = name.replaceAll("\\", "/");
  if (slashes.startsWith("/") || /^[A-Za-z]:\//.test(slashes)) {
    throw new Error("ZIP contains an absolute entry path.");
  }
  const components = slashes.split("/");
  if (components.some((component) => component === "..")) throw new Error("ZIP contains path traversal.");
  const clean = components.filter((component) => component && component !== ".").join("/").normalize("NFC");
  if (!clean) throw new Error("ZIP contains an invalid normalized entry path.");
  return clean;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD) return offset;
  }
  throw new Error("Input is not a supported ZIP archive.");
}

export function inspectZipBuffer(buffer) {
  if (buffer.length < 22) throw new Error("Input is not a supported ZIP archive.");
  const eocd = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== buffer.length) throw new Error("ZIP end record is malformed.");
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error("Multi-disk ZIP archives are not supported.");
  if (entryCount === 0xffff || centralSize === ZIP64_SENTINEL || centralOffset === ZIP64_SENTINEL) {
    throw new Error("ZIP64 archives are not supported by snapshot intake.");
  }
  if (entryCount > MAX_ENTRIES) throw new Error("ZIP contains too many entries.");
  if (centralOffset + centralSize > eocd) throw new Error("ZIP central directory is malformed.");

  const entries = [];
  const normalizedNames = new Set();
  let offset = centralOffset;
  let totalExpandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_ENTRY) {
      throw new Error("ZIP central directory entry is malformed.");
    }
    const madeBy = buffer.readUInt16LE(offset + 4);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    if ([compressedBytes, uncompressedBytes].includes(ZIP64_SENTINEL)) throw new Error("ZIP64 entries are not supported.");
    const end = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (end > buffer.length) throw new Error("ZIP central directory entry is truncated.");
    const encoding = flags & 0x0800 ? "utf8" : "latin1";
    const originalName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString(encoding);
    const path = normalizedArchivePath(originalName);
    if (localHeaderOffset + 30 > centralOffset || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error("ZIP local file header is malformed.");
    }
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    const localMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localNameEnd = localHeaderOffset + 30 + localNameLength;
    if (localNameEnd + localExtraLength > centralOffset) throw new Error("ZIP local file header is truncated.");
    const localEncoding = localFlags & 0x0800 ? "utf8" : "latin1";
    const localName = buffer.subarray(localHeaderOffset + 30, localNameEnd).toString(localEncoding);
    if (normalizedArchivePath(localName) !== path || localMethod !== method || localFlags !== flags) {
      throw new Error("ZIP local and central directory entries do not match.");
    }
    const normalizedKey = path.toLocaleLowerCase("en-US");
    if (normalizedNames.has(normalizedKey)) throw new Error("ZIP contains duplicate normalized entry paths.");
    normalizedNames.add(normalizedKey);
    if (flags & 0x0001) throw new Error("Encrypted ZIP entries are not supported.");
    if (![0, 8].includes(method)) throw new Error("ZIP contains an unsupported compression method.");

    const creatorSystem = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const unixType = unixMode & UNIX_FILE_TYPE;
    const dosDirectory = Boolean(externalAttributes & 0x10);
    const directory = originalName.endsWith("/") || dosDirectory || unixType === UNIX_DIRECTORY;
    if (creatorSystem === 3 && unixType === UNIX_SYMLINK) throw new Error("ZIP contains a symbolic link entry.");
    if (creatorSystem === 3 && unixType !== 0 && unixType !== UNIX_REGULAR && unixType !== UNIX_DIRECTORY) {
      throw new Error("ZIP contains an unsafe special entry.");
    }
    if (!directory) {
      if (uncompressedBytes > MAX_ENTRY_BYTES) throw new Error("ZIP entry exceeds the uncompressed size limit.");
      totalExpandedBytes += uncompressedBytes;
      if (totalExpandedBytes > MAX_EXPANDED_BYTES) throw new Error("ZIP exceeds the total uncompressed size limit.");
      if (uncompressedBytes >= RATIO_CHECK_MINIMUM_BYTES) {
        const ratio = compressedBytes === 0 ? Number.POSITIVE_INFINITY : uncompressedBytes / compressedBytes;
        if (ratio > MAX_COMPRESSION_RATIO) throw new Error("ZIP contains a suspicious compression ratio.");
      }
    }
    entries.push({ path, originalName, directory, compressedBytes, uncompressedBytes, method });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error("ZIP central directory size does not match its entries.");
  return { entries, totalExpandedBytes };
}

async function hashFile(path) {
  const data = await readFile(path);
  return { sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length };
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function resolvedThroughExistingAncestor(path) {
  const missing = [];
  let cursor = resolve(path);
  while (true) {
    try {
      const existing = await realpath(cursor);
      return resolve(existing, ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

export async function assertSafeDestination(destination, repositoryRoot = process.cwd()) {
  const protectedPath = resolve(repositoryRoot, "OriginalWinApp");
  const [protectedResolved, destinationResolved] = await Promise.all([
    resolvedThroughExistingAncestor(protectedPath),
    resolvedThroughExistingAncestor(destination),
  ]);
  if (isWithin(protectedPath, resolve(destination)) || isWithin(protectedResolved, destinationResolved)) {
    throw new Error("Destination must not be OriginalWinApp or a directory inside it.");
  }
}

async function extractZip(zipPath, directory) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn("unzip", ["-qq", zipPath, "-d", directory], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`ZIP extraction failed${stderr.trim() ? ": archive is invalid" : "."}`)));
  });
}

async function walkDirectories(root) {
  const directories = [root];
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Extracted snapshot contains a symbolic link.");
      if (entry.isDirectory()) directories.push(path);
      else if (!entry.isFile()) throw new Error("Extracted snapshot contains an unsafe special file.");
    }
  }
  return directories;
}

export async function discoverLegacyDataDirectory(extractionRoot) {
  const directories = await walkDirectories(extractionRoot);
  const candidates = [];
  const directoryFiles = new Map();
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = new Map();
    for (const entry of entries.filter((item) => item.isFile())) {
      const key = entry.name.toLocaleLowerCase("en-US");
      if (files.has(key)) throw new Error("A directory contains duplicate case-insensitive filenames.");
      files.set(key, entry.name);
    }
    directoryFiles.set(directory, files);
    if (REQUIRED_LEGACY_FILES.every((name) => files.has(name.toLocaleLowerCase("en-US")))) {
      candidates.push({ directory, files });
    }
  }
  if (candidates.length === 0) throw new Error("No directory contains the complete required Shopman32 source set.");
  candidates.sort((left, right) => relative(extractionRoot, left.directory).localeCompare(relative(extractionRoot, right.directory)));
  const applicationRoots = directories.filter((directory) => {
    const files = directoryFiles.get(directory);
    return files.has(LEGACY_EXECUTABLE) && LEGACY_SUPPORT_ARTIFACTS.some((name) => files.has(name));
  });
  const activeCandidates = candidates.flatMap((candidate) => {
    if (basename(candidate.directory).toLocaleLowerCase("en-US") !== "data") return [];
    const applicationRoot = dirname(candidate.directory);
    return applicationRoots.includes(applicationRoot) ? [{ candidate, applicationRoot }] : [];
  });
  let selected;
  let selectionRule;
  if (activeCandidates.length) {
    const depth = (path) => relative(extractionRoot, path).split(sep).filter(Boolean).length;
    const shallowestDepth = Math.min(...activeCandidates.map(({ applicationRoot }) => depth(applicationRoot)));
    const shallowest = activeCandidates.filter(({ applicationRoot }) => depth(applicationRoot) === shallowestDepth);
    if (shallowest.length !== 1) throw new Error("Multiple equally plausible active Shopman32 application roots were found.");
    selected = shallowest[0];
    selectionRule = "shallowest-application-root-direct-data";
  } else if (candidates.length === 1) {
    selected = { candidate: candidates[0], applicationRoot: dirname(candidates[0].directory) };
    selectionRule = "single-complete-data-directory-fallback";
  } else {
    throw new Error("Multiple complete Shopman32 data directories were found, but no unique active application root could be proven.");
  }
  const candidate = selected.candidate;
  const actualFiles = Object.fromEntries(REQUIRED_LEGACY_FILES.map((name) => [name, candidate.files.get(name.toLocaleLowerCase("en-US"))]));
  const companyFile = candidate.files.get("company.dbf") ?? null;
  const ignoredCandidates = candidates.filter((item) => item.directory !== candidate.directory).map((item) => {
    const itemParent = dirname(item.directory);
    let reason;
    if (applicationRoots.includes(itemParent) && basename(item.directory).toLocaleLowerCase("en-US") === "data") {
      reason = "Nested or deeper complete application tree; the shallower active Shopman32 root was selected.";
    } else if (itemParent === selected.applicationRoot) {
      reason = "Alternate or backup data directory; the active application root's direct data child was selected.";
    } else {
      reason = "Backup, alternate, or nested-copy candidate outside the selected active application root's direct data child.";
    }
    return { directory: item.directory, reason };
  });
  return {
    dataDirectory: candidate.directory,
    applicationRoot: selected.applicationRoot,
    actualFiles,
    companyFile,
    completeDataDirectoryCandidates: candidates.map((item) => item.directory),
    ignoredCandidates,
    selectionRule,
  };
}

export async function inspectDbf(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 33) throw new Error(`${basename(path)} is not a valid DBF file.`);
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(32);
    const initial = await handle.read(header, 0, 32, 0);
    if (initial.bytesRead !== 32) throw new Error(`${basename(path)} has a truncated DBF header.`);
    const versionByte = header[0];
    const declaredRowCount = header.readUInt32LE(4);
    const headerLength = header.readUInt16LE(8);
    const recordLength = header.readUInt16LE(10);
    const codePageMarker = header[29];
    if (headerLength < 33 || recordLength < 1 || headerLength > info.size) throw new Error(`${basename(path)} has invalid DBF dimensions.`);
    const descriptorBytes = Buffer.alloc(headerLength - 32);
    const descriptorRead = await handle.read(descriptorBytes, 0, descriptorBytes.length, 32);
    if (descriptorRead.bytesRead !== descriptorBytes.length) throw new Error(`${basename(path)} has a truncated field descriptor area.`);
    const fields = [];
    let terminatorFound = false;
    for (let offset = 0, order = 0; offset < descriptorBytes.length; offset += 32) {
      if (descriptorBytes[offset] === 0x0d) { terminatorFound = true; break; }
      if (offset + 32 > descriptorBytes.length) break;
      const descriptor = descriptorBytes.subarray(offset, offset + 32);
      const nameEnd = descriptor.indexOf(0);
      const name = descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd).toString("latin1").trim();
      const type = String.fromCharCode(descriptor[11]);
      const width = descriptor[16];
      const decimalCount = descriptor[17];
      if (!name || !/^[\x20-\x7e]$/.test(type) || width === 0) throw new Error(`${basename(path)} has a malformed DBF field descriptor.`);
      fields.push({ order, name, type, width, decimalCount });
      order += 1;
    }
    if (!terminatorFound) throw new Error(`${basename(path)} is missing the DBF field terminator.`);
    if (1 + fields.reduce((sum, field) => sum + field.width, 0) !== recordLength) {
      throw new Error(`${basename(path)} field widths do not match its record length.`);
    }
    const expectedDataEnd = headerLength + declaredRowCount * recordLength;
    const availableRecordBytes = Math.max(0, Math.min(info.size, expectedDataEnd) - headerLength);
    const physicallyReadableRowCount = Math.floor(availableRecordBytes / recordLength);
    let malformedOrTruncatedRowCount = Math.max(0, declaredRowCount - physicallyReadableRowCount);
    let activeRowCount = 0;
    let sourceDeletedRowCount = 0;
    const marker = Buffer.alloc(1);
    for (let index = 0; index < physicallyReadableRowCount; index += 1) {
      const read = await handle.read(marker, 0, 1, headerLength + index * recordLength);
      if (read.bytesRead !== 1) { malformedOrTruncatedRowCount += 1; continue; }
      if (marker[0] === 0x20) activeRowCount += 1;
      else if (marker[0] === 0x2a) sourceDeletedRowCount += 1;
      else malformedOrTruncatedRowCount += 1;
    }
    if (info.size < expectedDataEnd) malformedOrTruncatedRowCount = Math.max(malformedOrTruncatedRowCount, 1);
    if (info.size > expectedDataEnd) {
      const extraLength = info.size - expectedDataEnd;
      const extra = Buffer.alloc(Math.min(extraLength, 2));
      await handle.read(extra, 0, extra.length, expectedDataEnd);
      if (extraLength !== 1 || extra[0] !== 0x1a) malformedOrTruncatedRowCount += 1;
    }
    if (malformedOrTruncatedRowCount > 0) throw new Error(`${basename(path)} contains malformed or truncated DBF records.`);
    return {
      versionByte,
      codePageMarker,
      headerLength,
      recordLength,
      declaredRowCount,
      physicallyReadableRowCount,
      activeRowCount,
      sourceDeletedRowCount,
      malformedOrTruncatedRowCount,
      memoFieldPresent: fields.some((field) => ["M", "G", "P"].includes(field.type)),
      fields,
    };
  } finally {
    await handle.close();
  }
}

export async function inspectLaborMemo(path) {
  const data = await readFile(path);
  if (data.length < 512) throw new Error("laborfinal.FPT is empty or too small to be a valid memo file.");
  const nextFreeBlock = data.readUInt32BE(0);
  const blockSize = data.readUInt16BE(6);
  if (blockSize < 32 || blockSize > 65_535 || data.length < blockSize) {
    throw new Error("laborfinal.FPT has an invalid memo block size.");
  }
  if (nextFreeBlock && nextFreeBlock * blockSize < data.length - blockSize) {
    throw new Error("laborfinal.FPT has an inconsistent next-free-block header.");
  }
  return { bytes: data.length, blockSize, nextFreeBlock };
}

async function inventoryFiles(root) {
  const directories = await walkDirectories(root);
  const files = {};
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile())) {
      const path = join(directory, entry.name);
      files[relative(root, path).split(sep).join("/")] = await hashFile(path);
    }
  }
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

function manifestRelative(root, path) {
  const result = relative(root, path).split(sep).join("/");
  return result || ".";
}

export async function runSnapshotIntake(options, { repositoryRoot = process.cwd(), now = () => new Date() } = {}) {
  const zipPath = resolve(options.zip);
  const destination = resolve(options.destination);
  await assertSafeDestination(destination, repositoryRoot);
  await access(zipPath, constants.R_OK);
  const zipInfo = await stat(zipPath);
  if (!zipInfo.isFile()) throw new Error("--zip must identify a readable regular file.");
  const zipData = await readFile(zipPath);
  const zipInspection = inspectZipBuffer(zipData);
  const zipSha256 = createHash("sha256").update(zipData).digest("hex");
  const finalName = `${options.snapshotDate}-${zipSha256.slice(0, 12)}`;
  const finalPath = join(destination, finalName);
  try {
    await lstat(finalPath);
    throw new Error(`Snapshot destination already exists: ${finalName}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(destination, { recursive: true });
  const temporaryPath = await mkdtemp(join(destination, `.${finalName}-tmp-`));
  let completed = false;
  try {
    await extractZip(zipPath, temporaryPath);
    const discovered = await discoverLegacyDataDirectory(temporaryPath);
    const warnings = [];
    const requiredFiles = {};
    for (const expected of REQUIRED_LEGACY_FILES) {
      const actual = discovered.actualFiles[expected];
      requiredFiles[expected] = actual;
      if (actual !== expected) warnings.push(`Required filename casing differs: ${expected} is stored as ${actual}.`);
    }
    const dbfTables = {};
    for (const expected of DBF_FILES) {
      const actual = discovered.actualFiles[expected];
      dbfTables[expected] = await inspectDbf(join(discovered.dataDirectory, actual));
    }
    if (discovered.companyFile) {
      dbfTables["company.dbf"] = await inspectDbf(join(discovered.dataDirectory, discovered.companyFile));
    } else {
      warnings.push("company.dbf was not present; company settings are not imported by this command.");
    }
    const laborMemo = await inspectLaborMemo(join(discovered.dataDirectory, discovered.actualFiles["laborfinal.FPT"]));
    const files = await inventoryFiles(temporaryPath);
    const manifest = {
      formatVersion: 1,
      snapshotDate: options.snapshotDate,
      receivedFilename: basename(zipPath),
      zipSha256,
      zipBytes: zipInfo.size,
      createdAt: now().toISOString(),
      detectedApplicationRoot: manifestRelative(temporaryPath, discovered.applicationRoot),
      detectedDataDirectory: manifestRelative(temporaryPath, discovered.dataDirectory),
      completeDataDirectoryCandidates: discovered.completeDataDirectoryCandidates.map((path) => manifestRelative(temporaryPath, path)),
      ignoredDataDirectoryCandidates: discovered.ignoredCandidates.map((candidate) => ({
        directory: manifestRelative(temporaryPath, candidate.directory), reason: candidate.reason,
      })),
      dataDirectorySelectionRule: discovered.selectionRule,
      requiredFileValidation: {
        valid: true,
        required: [...REQUIRED_LEGACY_FILES],
        actualFiles: discovered.actualFiles,
      },
      archive: {
        entryCount: zipInspection.entries.length,
        totalUncompressedBytes: zipInspection.totalExpandedBytes,
      },
      files,
      dbfTables,
      laborMemo,
      warnings,
      fatalIssues: [],
    };
    if (options.dryRun) {
      return { dryRun: true, finalPath, dataDirectory: join(finalPath, manifest.detectedDataDirectory), manifest };
    }
    await writeFile(join(temporaryPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try {
      await lstat(finalPath);
      throw new Error(`Snapshot destination already exists: ${finalName}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(temporaryPath, finalPath);
    completed = true;
    return { dryRun: false, finalPath, dataDirectory: join(finalPath, manifest.detectedDataDirectory), manifest };
  } finally {
    if (!completed) await rm(temporaryPath, { recursive: true, force: true });
  }
}

function printResult(result) {
  const counts = Object.fromEntries(Object.entries(result.manifest.dbfTables).map(([name, table]) => [name, {
    declared: table.declaredRowCount,
    active: table.activeRowCount,
    deleted: table.sourceDeletedRowCount,
  }]));
  console.log(`Legacy snapshot intake: ${result.dryRun ? "DRY RUN PASS" : "PASS"}`);
  console.log(`ZIP SHA-256: ${result.manifest.zipSha256}`);
  console.log(`ZIP bytes: ${result.manifest.zipBytes}`);
  console.log(`Required files valid: ${result.manifest.requiredFileValidation.valid ? "yes" : "no"}`);
  for (const [name, count] of Object.entries(counts)) {
    console.log(`${name}: declared=${count.declared}, active=${count.active}, deleted=${count.deleted}`);
  }
  console.log(`Warnings: ${result.manifest.warnings.length}`);
  if (result.dryRun) console.log("Persistent files created: 0");
  else {
    console.log(`Snapshot path: ${result.finalPath}`);
    console.log(`Cutover --source: ${result.dataDirectory}`);
  }
  console.log("Database access performed: 0");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSnapshotIntakeArguments(process.argv.slice(2));
    printResult(await runSnapshotIntake(options));
  } catch (error) {
    console.error(`Legacy snapshot intake failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  }
}
