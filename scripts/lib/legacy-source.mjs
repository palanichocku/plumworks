import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, realpath, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function legacySourceFingerprint(requiredFiles, fingerprints) {
  if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) throw new Error("Legacy source fingerprinting requires at least one filename.");
  if (new Set(requiredFiles).size !== requiredFiles.length) throw new Error("Legacy source fingerprinting requires unique filenames.");
  const fingerprint = createHash("sha256");
  for (const expected of requiredFiles) {
    const hash = fingerprints?.[expected];
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Legacy source fingerprint is missing a valid SHA-256 for ${expected}.`);
    fingerprint.update(expected).update("\0").update(hash).update("\0");
  }
  return fingerprint.digest("hex");
}

export function validateSnapshotBoundSourceScope({ snapshot, cutoverSource, binding }) {
  const issues = [];
  const fail = (code, file = null) => issues.push({ code, file });
  const requiredFiles = snapshot?.manifest?.requiredFileValidation?.required;
  if (!Array.isArray(requiredFiles) || requiredFiles.length === 0 || new Set(requiredFiles).size !== requiredFiles.length) {
    fail("invalid-snapshot-required-file-scope");
    return { issues, scopedSource: null };
  }
  if (snapshot.source?.path !== cutoverSource?.path) fail("snapshot-source-directory-mismatch");

  // The consolidated source may be broader, but every selected file must still
  // be an immutable member of the intake manifest.
  for (const [file, path] of Object.entries(cutoverSource?.files ?? {})) {
    if (!isWithin(snapshot.snapshotRoot, path)) { fail("cutover-source-path-outside-snapshot", file); continue; }
    const manifestPath = relative(snapshot.snapshotRoot, path).split(sep).join("/");
    const manifestEntry = snapshot.manifest?.files?.[manifestPath];
    if (!manifestEntry) { fail("cutover-source-file-not-in-snapshot-manifest", file); continue; }
    if (manifestEntry.sha256 !== cutoverSource.fingerprints?.[file]) fail("cutover-source-manifest-hash-mismatch", file);
  }

  const boundFiles = Object.keys(binding?.sourceHashes ?? {});
  if (boundFiles.length !== requiredFiles.length || requiredFiles.some((file) => !boundFiles.includes(file))) {
    fail("artifact-source-scope-mismatch");
  }
  for (const file of requiredFiles) {
    if (!snapshot.source?.files?.[file] || !cutoverSource?.files?.[file]) { fail("artifact-source-file-missing", file); continue; }
    if (snapshot.source.files[file] !== cutoverSource.files[file] || snapshot.source.actualFiles?.[file] !== cutoverSource.actualFiles?.[file]) {
      fail("artifact-source-file-identity-mismatch", file);
    }
    const expectedHash = snapshot.source.fingerprints?.[file];
    const actualHash = cutoverSource.fingerprints?.[file];
    if (expectedHash !== actualHash || binding?.sourceHashes?.[file] !== actualHash) fail("artifact-source-file-hash-mismatch", file);
  }

  let fingerprint = null;
  try { fingerprint = legacySourceFingerprint(requiredFiles, cutoverSource?.fingerprints); }
  catch { fail("artifact-scoped-fingerprint-unavailable"); }
  if (fingerprint && binding?.combinedSourceFingerprint !== fingerprint) fail("artifact-scoped-fingerprint-mismatch");
  if (issues.length) return { issues, scopedSource: null };
  return {
    issues,
    scopedSource: {
      ...cutoverSource,
      files: Object.fromEntries(requiredFiles.map((file) => [file, cutoverSource.files[file]])),
      actualFiles: Object.fromEntries(requiredFiles.map((file) => [file, cutoverSource.actualFiles[file]])),
      fingerprints: Object.fromEntries(requiredFiles.map((file) => [file, cutoverSource.fingerprints[file]])),
      fingerprint,
    },
  };
}

function sourceArgument(args) {
  const positions = args.flatMap((value, index) => value === "--source" ? [index] : []);
  if (positions.length !== 1) throw new Error("--source must be provided exactly once; repository seed data is never used as a fallback.");
  const value = args[positions[0] + 1];
  if (!value || value.startsWith("--")) throw new Error("--source requires an explicit snapshot data directory.");
  return value;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

export async function resolveLegacySource({
  args = process.argv.slice(2),
  requiredFiles,
  repositoryRoot = process.cwd(),
}) {
  if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) throw new Error("Legacy source validation requires at least one filename.");
  const requestedPath = resolve(sourceArgument(args));
  const protectedPath = resolve(repositoryRoot, "OriginalWinApp");
  let protectedResolved = protectedPath;
  try {
    protectedResolved = await realpath(protectedPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let resolvedPath;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("--source directory does not exist.");
    throw error;
  }
  if (isWithin(protectedPath, requestedPath) || isWithin(protectedResolved, resolvedPath)) {
    throw new Error("--source must not be OriginalWinApp or a directory inside it.");
  }
  await access(resolvedPath, constants.R_OK);
  const sourceInfo = await stat(resolvedPath);
  if (!sourceInfo.isDirectory()) throw new Error("--source must be a readable directory.");

  const entries = await readdir(resolvedPath, { withFileTypes: true });
  const filesByName = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const key = entry.name.toLocaleLowerCase("en-US");
    if (filesByName.has(key)) throw new Error(`--source contains duplicate case-insensitive filenames for ${entry.name}.`);
    filesByName.set(key, entry.name);
  }
  const files = {};
  const fingerprints = {};
  for (const expected of requiredFiles) {
    const actual = filesByName.get(expected.toLocaleLowerCase("en-US"));
    if (!actual) throw new Error(`--source is missing required file: ${expected}`);
    const path = resolve(resolvedPath, actual);
    await access(path, constants.R_OK);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Required source is not a regular file: ${actual}`);
    files[expected] = path;
    fingerprints[expected] = await hashFile(path);
  }
  return {
    path: resolvedPath,
    files,
    actualFiles: Object.fromEntries(requiredFiles.map((expected) => [expected, filesByName.get(expected.toLocaleLowerCase("en-US"))])),
    fingerprints,
    fingerprint: legacySourceFingerprint(requiredFiles, fingerprints),
  };
}

export function printLegacySourceSummary(source) {
  console.log(`legacy source directory: ${source.path}`);
  console.log(`legacy source required files: ${Object.values(source.actualFiles).join(", ")}`);
  console.log(`legacy source fingerprint SHA-256: ${source.fingerprint}`);
}
