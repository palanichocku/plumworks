import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveLegacySource } from "./lib/legacy-source.mjs";

const refreshScripts = [
  "scripts/legacy-cutover.mjs",
  "scripts/import-customers-vehicles.mjs",
  "scripts/import-invoices.mjs",
  "scripts/import-open-orders.mjs",
  "scripts/diagnose-labor-memo-format.mjs",
  "scripts/restage-labor-memos.mjs",
];

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "plumworks-source-safety-"));
  await mkdir(join(root, "OriginalWinApp"));
  return root;
}

test("omitting or duplicating --source fails clearly", async () => {
  const root = await sandbox();
  try {
    await assert.rejects(resolveLegacySource({ args: [], requiredFiles: ["Cust.DBF"], repositoryRoot: root }), /exactly once/);
    await assert.rejects(resolveLegacySource({ args: ["--source", "one", "--source", "two"], requiredFiles: ["Cust.DBF"], repositoryRoot: root }), /exactly once/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("OriginalWinApp and directories beneath it are rejected, including through a symlink", async () => {
  const root = await sandbox();
  try {
    const protectedRoot = join(root, "OriginalWinApp");
    const nested = join(protectedRoot, "Shopman32", "data");
    await mkdir(nested, { recursive: true });
    await assert.rejects(resolveLegacySource({ args: ["--source", protectedRoot], requiredFiles: ["Cust.DBF"], repositoryRoot: root }), /must not be OriginalWinApp/);
    await assert.rejects(resolveLegacySource({ args: ["--source", nested], requiredFiles: ["Cust.DBF"], repositoryRoot: root }), /must not be OriginalWinApp/);
    const linked = join(root, "linked-seed");
    await symlink(nested, linked);
    await assert.rejects(resolveLegacySource({ args: ["--source", linked], requiredFiles: ["Cust.DBF"], repositoryRoot: root }), /must not be OriginalWinApp/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an external immutable snapshot resolves actual casing and fingerprints required files", async () => {
  const root = await sandbox();
  try {
    const sourcePath = join(root, "snapshots", "2026-07-31-abc123", "Shopman32", "data");
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, "CUST.dbf"), "customer fixture");
    await writeFile(join(sourcePath, "Vehicles.DBF"), "vehicle fixture");
    const source = await resolveLegacySource({
      args: ["--source", sourcePath],
      requiredFiles: ["Cust.DBF", "vehicles.DBF"],
      repositoryRoot: root,
    });
    assert.equal(source.path, await realpath(sourcePath));
    assert.equal(source.actualFiles["Cust.DBF"], "CUST.dbf");
    assert.equal(source.actualFiles["vehicles.DBF"], "Vehicles.DBF");
    assert.match(source.fingerprint, /^[0-9a-f]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing required source files fail by name before any database work", async () => {
  const root = await sandbox();
  try {
    const sourcePath = join(root, "snapshot");
    await mkdir(sourcePath);
    await writeFile(join(sourcePath, "Cust.DBF"), "fixture");
    await assert.rejects(resolveLegacySource({
      args: ["--source", sourcePath],
      requiredFiles: ["Cust.DBF", "vehicles.DBF"],
      repositoryRoot: root,
    }), /missing required file: vehicles\.DBF/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("labor memo utilities resolve both files exclusively from the supplied source", async () => {
  const [diagnostic, restage] = await Promise.all([
    readFile("scripts/diagnose-labor-memo-format.mjs", "utf8"),
    readFile("scripts/restage-labor-memos.mjs", "utf8"),
  ]);
  for (const source of [diagnostic, restage]) {
    assert.match(source, /resolveLegacySource\(\{ requiredFiles: \["laborfinal\.DBF", "laborfinal\.FPT"\] \}\)/);
    assert.match(source, /source\.files\["laborfinal\.DBF"\]/);
    assert.match(source, /source\.files\["laborfinal\.FPT"\]/);
    assert.doesNotMatch(source, /OriginalWinApp\/Shopman32\/data/);
  }
});

test("cutover forwards its one resolved source path to every filesystem import stage", async () => {
  const source = await readFile("scripts/legacy-cutover.mjs", "utf8");
  assert.match(source, /resolveLegacySource\(\{ requiredFiles: REQUIRED_SOURCES \}\)/);
  assert.match(source, /const common = \["--source", sourceDirectory\.path, "--shop-id", shopId\]/);
  assert.match(source, /runScriptWithOutput\("import-customers-vehicles\.mjs", common\)/);
  assert.match(source, /runScriptWithOutput\("import-invoices\.mjs", common\)/);
  assert.match(source, /runScript\("import-open-orders\.mjs", common\)/);
});

test("no refresh runtime contains the repository seed fallback", async () => {
  for (const path of refreshScripts) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /OriginalWinApp\/Shopman32\/data/, path);
    assert.doesNotMatch(source, /sourceFolder\s*\?[^\n]*OriginalWinApp/, path);
  }
});
