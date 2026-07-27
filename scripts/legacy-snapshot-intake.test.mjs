import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertSafeDestination,
  inspectZipBuffer,
  parseSnapshotIntakeArguments,
  REQUIRED_LEGACY_FILES,
  runSnapshotIntake,
} from "./legacy-snapshot-intake.mjs";

test("requires one ZIP, a strict date, and an explicit destination", () => {
  assert.deepEqual(parseSnapshotIntakeArguments([
    "--zip", "/tmp/shopman32.zip", "--snapshot-date", "2026-07-31", "--destination", "/tmp/snapshots", "--dry-run",
  ]), { zip: "/tmp/shopman32.zip", snapshotDate: "2026-07-31", destination: "/tmp/snapshots", dryRun: true });
  assert.throws(() => parseSnapshotIntakeArguments(["--snapshot-date", "2026-07-31", "--destination", "/tmp/snapshots"]), /--zip/);
  assert.throws(() => parseSnapshotIntakeArguments(["--zip", "one", "--zip", "two", "--snapshot-date", "2026-07-31", "--destination", "/tmp/snapshots"]), /exactly once/);
  assert.throws(() => parseSnapshotIntakeArguments(["--zip", "one", "--snapshot-date", "2026-02-30", "--destination", "/tmp/snapshots"]), /valid calendar/);
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? "");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((entry.unix === false ? 0 : 3) << 8 | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

function dbf({ truncated = false } = {}) {
  const headerLength = 65;
  const recordLength = 5;
  const buffer = Buffer.alloc(headerLength + recordLength + (truncated ? 0 : 1));
  buffer[0] = 0x03;
  buffer.writeUInt32LE(truncated ? 2 : 1, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  buffer[29] = 0x03;
  buffer.write("ID", 32, "ascii");
  buffer[43] = "C".charCodeAt(0);
  buffer[48] = 4;
  buffer[64] = 0x0d;
  buffer[65] = 0x20;
  buffer.write("1   ", 66, "ascii");
  if (!truncated) buffer[70] = 0x1a;
  return buffer;
}

function fpt() {
  const buffer = Buffer.alloc(512);
  buffer.writeUInt32BE(1, 0);
  buffer.writeUInt16BE(512, 6);
  return buffer;
}

function fixtureEntries(prefix = "Shopman32/data", options = {}) {
  return REQUIRED_LEGACY_FILES.map((expected, index) => {
    const actual = options.caseDifferences && index === 0 ? "CUST.dbf" : expected;
    const data = expected.endsWith(".FPT") ? fpt() : dbf({ truncated: options.truncated === expected });
    return { name: `${prefix}/${actual}`, data };
  });
}

function applicationArtifacts(root = "Shopman32") {
  return [
    { name: `${root}/shopman32.exe`, data: "executable" },
    { name: `${root}/vfp8r.dll`, data: "runtime" },
  ];
}

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "plumworks-intake-test-"));
  const zipPath = join(root, "shopman32.zip");
  await writeFile(zipPath, zip(options.entries ?? fixtureEntries(options.prefix, options)));
  return { root, zipPath, destination: join(root, "snapshots") };
}

async function withFixture(options, callback) {
  const current = await fixture(options);
  try { await callback(current); } finally { await rm(current.root, { recursive: true, force: true }); }
}

test("accepts a valid nested Shopman32/data ZIP", async () => withFixture({}, async ({ zipPath, destination }) => {
  const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: false });
  assert.equal(result.manifest.requiredFileValidation.valid, true);
  assert.equal(result.manifest.detectedDataDirectory, "Shopman32/data");
  assert.equal(JSON.parse(await readFile(join(result.finalPath, "manifest.json"), "utf8")).formatVersion, 1);
}));

test("discovers Shopman32/data beneath an extra top-level folder", async () => withFixture({ prefix: "Customer Backup/Shopman32/data" }, async ({ zipPath, destination }) => {
  const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
  assert.equal(result.manifest.detectedDataDirectory, "Customer Backup/Shopman32/data");
}));

test("prefers canonical Shopman32/data over data - Copy regardless of traversal order", async () => {
  const entries = [
    ...fixtureEntries("Shopman32/data - Copy"),
    ...applicationArtifacts(),
    ...fixtureEntries("Shopman32/data"),
  ];
  await withFixture({ entries }, async ({ zipPath, destination }) => {
    const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
    assert.equal(result.manifest.detectedApplicationRoot, "Shopman32");
    assert.equal(result.manifest.detectedDataDirectory, "Shopman32/data");
    assert.deepEqual(result.manifest.completeDataDirectoryCandidates, ["Shopman32/data", "Shopman32/data - Copy"]);
    assert.match(result.manifest.ignoredDataDirectoryCandidates[0].reason, /Alternate or backup/);
  });
});

test("canonical data wins over NEWDATA and good", async () => {
  const entries = [...fixtureEntries("Shopman32/NEWDATA"), ...fixtureEntries("Shopman32/good"), ...fixtureEntries("Shopman32/data"), ...applicationArtifacts()];
  await withFixture({ entries }, async ({ zipPath, destination }) => {
    const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
    assert.equal(result.manifest.detectedDataDirectory, "Shopman32/data");
    assert.deepEqual(result.manifest.ignoredDataDirectoryCandidates.map((candidate) => candidate.directory).sort(), ["Shopman32/NEWDATA", "Shopman32/good"].sort());
  });
});

test("a shallow complete application tree wins over a nested duplicate application tree", async () => {
  const entries = [
    ...applicationArtifacts("Shopman32/Shopman32"), ...fixtureEntries("Shopman32/Shopman32/data"),
    ...applicationArtifacts("Shopman32"), ...fixtureEntries("Shopman32/data"),
  ];
  await withFixture({ entries }, async ({ zipPath, destination }) => {
    const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
    assert.equal(result.manifest.detectedApplicationRoot, "Shopman32");
    assert.equal(result.manifest.detectedDataDirectory, "Shopman32/data");
    assert.match(result.manifest.ignoredDataDirectoryCandidates[0].reason, /Nested or deeper/);
    assert.equal(result.manifest.dataDirectorySelectionRule, "shallowest-application-root-direct-data");
  });
});

test("a wrapper folder above one application root remains supported", async () => {
  const entries = [...applicationArtifacts("Customer Backup/Shopman32"), ...fixtureEntries("Customer Backup/Shopman32/data")];
  await withFixture({ entries }, async ({ zipPath, destination }) => {
    const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
    assert.equal(result.manifest.detectedApplicationRoot, "Customer Backup/Shopman32");
    assert.equal(result.manifest.detectedDataDirectory, "Customer Backup/Shopman32/data");
  });
});

test("two equally plausible active application roots remain ambiguous", async () => {
  const entries = [
    ...applicationArtifacts("one/Shopman32"), ...fixtureEntries("one/Shopman32/data"),
    ...applicationArtifacts("two/Shopman32"), ...fixtureEntries("two/Shopman32/data"),
  ];
  await withFixture({ entries }, async ({ zipPath, destination }) => {
    await assert.rejects(runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true }), /equally plausible/);
  });
});

test("one standalone complete data directory retains single-candidate fallback", async () => {
  await withFixture({ prefix: "standalone/source" }, async ({ zipPath, destination }) => {
    const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
    assert.equal(result.manifest.detectedDataDirectory, "standalone/source");
    assert.equal(result.manifest.dataDirectorySelectionRule, "single-complete-data-directory-fallback");
    assert.deepEqual(result.manifest.ignoredDataDirectoryCandidates, []);
  });
});

test("rejects path traversal and absolute archive paths", () => {
  assert.throws(() => inspectZipBuffer(zip([{ name: "../escape", data: "x" }])), /traversal/);
  assert.throws(() => inspectZipBuffer(zip([{ name: "/absolute", data: "x" }])), /absolute/);
});

test("rejects symbolic link entries", () => {
  assert.throws(() => inspectZipBuffer(zip([{ name: "link", data: "target", mode: 0o120777 }])), /symbolic link/);
});

test("rejects a missing required source file", async () => {
  const entries = fixtureEntries().filter((entry) => !entry.name.endsWith("ar.DBF"));
  await withFixture({ entries }, async ({ zipPath, destination }) => {
    await assert.rejects(runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true }), /complete required/);
  });
});

test("rejects duplicate complete data-directory candidates", async () => {
  const entries = [...fixtureEntries("one/Shopman32/data"), ...fixtureEntries("two/Shopman32/data")];
  await withFixture({ entries }, async ({ zipPath, destination }) => {
    await assert.rejects(runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true }), /Multiple complete/);
  });
});

test("rejects an existing immutable destination", async () => withFixture({}, async ({ zipPath, destination }) => {
  const first = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: false });
  await assert.rejects(runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: false }), /already exists/);
  assert.equal((await readdir(first.finalPath)).includes("manifest.json"), true);
}));

test("rejects destinations inside OriginalWinApp, including symlink resolution", async () => {
  await assert.rejects(assertSafeDestination(join(process.cwd(), "OriginalWinApp", "snapshots")), /OriginalWinApp/);
  const root = await mkdtemp(join(tmpdir(), "plumworks-intake-link-test-"));
  try {
    await mkdir(join(root, "OriginalWinApp"));
    const { symlink } = await import("node:fs/promises");
    await symlink(join(root, "OriginalWinApp"), join(root, "linked"));
    await assert.rejects(assertSafeDestination(join(root, "linked", "snapshots"), root), /OriginalWinApp/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("matches required filenames case-insensitively and reports actual casing", async () => withFixture({ caseDifferences: true }, async ({ zipPath, destination }) => {
  const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
  assert.equal(result.manifest.requiredFileValidation.actualFiles["Cust.DBF"], "CUST.dbf");
  assert.match(result.manifest.warnings.join(" "), /casing differs/);
}));

test("dry run removes its temporary extraction and creates no snapshot", async () => withFixture({}, async ({ zipPath, destination }) => {
  const result = await runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true });
  assert.equal(result.dryRun, true);
  assert.deepEqual(await readdir(destination), []);
}));

test("rejects malformed or truncated DBF records and cleans temporary files", async () => withFixture({ truncated: "FINAL.DBF" }, async ({ zipPath, destination }) => {
  await assert.rejects(runSnapshotIntake({ zip: zipPath, destination, snapshotDate: "2026-07-31", dryRun: true }), /malformed or truncated/);
  assert.deepEqual(await readdir(destination), []);
}));
