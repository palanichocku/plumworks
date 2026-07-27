import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, realpath, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
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
  const fingerprint = createHash("sha256");
  for (const expected of requiredFiles) fingerprint.update(expected).update("\0").update(fingerprints[expected]).update("\0");
  return {
    path: resolvedPath,
    files,
    actualFiles: Object.fromEntries(requiredFiles.map((expected) => [expected, filesByName.get(expected.toLocaleLowerCase("en-US"))])),
    fingerprints,
    fingerprint: fingerprint.digest("hex"),
  };
}

export function printLegacySourceSummary(source) {
  console.log(`legacy source directory: ${source.path}`);
  console.log(`legacy source required files: ${Object.values(source.actualFiles).join(", ")}`);
  console.log(`legacy source fingerprint SHA-256: ${source.fingerprint}`);
}
