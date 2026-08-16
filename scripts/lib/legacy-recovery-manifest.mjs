import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function recoveryManifestArgument(args = process.argv.slice(2), { required = true } = {}) {
  const positions = args.flatMap((value, index) => value === "--customer-recovery-manifest" ? [index] : []);
  if (positions.length > 1) throw new Error("--customer-recovery-manifest must not be supplied more than once.");
  if (positions.length === 0) {
    if (required) throw new Error("--customer-recovery-manifest is required because this source has unresolved Customer references.");
    return null;
  }
  const value = args[positions[0] + 1];
  if (!value || value.startsWith("--")) throw new Error("--customer-recovery-manifest requires an explicit file path.");
  return value;
}

export function recoveryProposalArgument(args = process.argv.slice(2), { required = false } = {}) {
  const positions = args.flatMap((value, index) => value === "--customer-recovery-proposal" ? [index] : []);
  if (positions.length > 1) throw new Error("--customer-recovery-proposal must not be supplied more than once.");
  if (!positions.length) {
    if (required) throw new Error("--customer-recovery-proposal is required for snapshot-bound Recovery Approval v4.");
    return null;
  }
  const value = args[positions[0] + 1];
  if (!value || value.startsWith("--")) throw new Error("--customer-recovery-proposal requires an explicit file path.");
  return value;
}

export async function loadRecoveryManifest({ path, repositoryRoot = process.cwd() }) {
  const requested = resolve(path);
  const protectedPath = resolve(repositoryRoot, "OriginalWinApp");
  let protectedResolved = protectedPath;
  try { protectedResolved = await realpath(protectedPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  let resolvedPath;
  try { resolvedPath = await realpath(requested); } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Customer recovery manifest does not exist.");
    throw error;
  }
  if (isWithin(protectedPath, requested) || isWithin(protectedResolved, resolvedPath)) {
    throw new Error("Customer recovery manifest must not be inside OriginalWinApp.");
  }
  await access(resolvedPath, constants.R_OK);
  const info = await stat(resolvedPath);
  if (!info.isFile()) throw new Error("Customer recovery manifest must be a readable regular file.");
  let manifest;
  try { manifest = JSON.parse(await readFile(resolvedPath, "utf8")); }
  catch { throw new Error("Customer recovery manifest is not valid JSON."); }
  return { path: resolvedPath, manifest };
}
