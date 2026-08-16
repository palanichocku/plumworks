import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function canonicalizeEvidence(value) {
  if (Array.isArray(value)) return value.map(canonicalizeEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeEvidence(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalizeEvidence(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function evidenceHash(value) {
  return sha256(canonicalJson(value));
}

export function keyedEvidenceRows(rows, sourceModel) {
  const occurrences = new Map();
  return rows.map((row) => {
    const rawHash = evidenceHash(row.rawData);
    const occurrence = (occurrences.get(rawHash) ?? 0) + 1;
    occurrences.set(rawHash, occurrence);
    return {
      ...row,
      evidenceSha256: evidenceHash({ deleted: row.deleted === true, rawData: row.rawData }),
      stableRowKey: `${sourceModel}:${rawHash.slice(0, 24)}:${occurrence}`,
    };
  });
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function resolvedThroughExistingAncestor(path) {
  const missing = [];
  let cursor = resolve(path);
  while (true) {
    try { return resolve(await realpath(cursor), ...missing.reverse()); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

export async function assertPrivateArtifactPath(path, repositoryRoot = process.cwd()) {
  const target = resolve(path);
  const [targetResolved, repositoryResolved, originalResolved] = await Promise.all([
    resolvedThroughExistingAncestor(target),
    resolvedThroughExistingAncestor(repositoryRoot),
    resolvedThroughExistingAncestor(resolve(repositoryRoot, "OriginalWinApp")),
  ]);
  if (isWithin(repositoryResolved, targetResolved)) throw new Error("Private recovery artifacts must be stored outside the Git repository.");
  if (isWithin(originalResolved, targetResolved)) throw new Error("Private recovery artifacts must not be stored inside OriginalWinApp.");
  return target;
}

export async function readablePrivateJson(path, label, repositoryRoot = process.cwd()) {
  const requested = resolve(path);
  await assertPrivateArtifactPath(requested, repositoryRoot);
  await access(requested, constants.R_OK);
  if (!(await stat(requested)).isFile()) throw new Error(`${label} must be a readable regular file.`);
  const bytes = await readFile(requested);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} must contain valid JSON.`); }
  return { path: await realpath(requested), bytes, value, sha256: sha256(bytes) };
}

export async function atomicPrivateJsonWrite(path, value, repositoryRoot = process.cwd()) {
  const output = await assertPrivateArtifactPath(path, repositoryRoot);
  try { await lstat(output); throw new Error("Output artifact already exists."); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const temporaryDirectory = await mkdtemp(join(dirname(output), `.${basename(output)}-tmp-`));
  const temporary = join(temporaryDirectory, basename(output));
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, output);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return output;
}
