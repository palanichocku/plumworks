import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  executeLegacyInvoiceWriteTransaction,
  parseLegacyInvoiceTransformerArguments,
} from "./lib/legacy-invoice-transformer-safety.mjs";

test("no arguments resolves to dry-run mode", () => {
  const result = parseLegacyInvoiceTransformerArguments([]);
  assert.equal(result.dryRun, true);
  assert.equal(result.confirmedWrite, false);
});

test("explicit --dry-run resolves to dry-run mode", () => {
  assert.equal(parseLegacyInvoiceTransformerArguments(["--dry-run"]).dryRun, true);
});

test("correct confirmation token resolves to write mode", () => {
  const result = parseLegacyInvoiceTransformerArguments(["--confirm", "TRANSFORM_LEGACY_INVOICES"]);
  assert.equal(result.dryRun, false);
  assert.equal(result.confirmedWrite, true);
});

test("wrong, missing, and duplicate confirmation arguments fail", () => {
  assert.throws(() => parseLegacyInvoiceTransformerArguments(["--confirm", "WRONG"]), /must equal TRANSFORM_LEGACY_INVOICES/);
  assert.throws(() => parseLegacyInvoiceTransformerArguments(["--confirm"]), /requires a value/);
  assert.throws(() => parseLegacyInvoiceTransformerArguments(["--confirm", "TRANSFORM_LEGACY_INVOICES", "--confirm", "TRANSFORM_LEGACY_INVOICES"]), /Duplicate argument/);
});

test("conflicting dry-run and confirmation arguments fail", () => {
  assert.throws(() => parseLegacyInvoiceTransformerArguments(["--dry-run", "--confirm", "TRANSFORM_LEGACY_INVOICES"]), /cannot be combined/);
});

test("unknown arguments fail", () => {
  assert.throws(() => parseLegacyInvoiceTransformerArguments(["--write"]), /Unknown argument/);
});

test("dry-run cannot enter the write transaction and reports zero writes", async () => {
  let calls = 0;
  const result = await executeLegacyInvoiceWriteTransaction({ confirmedWrite: false, execute: async () => { calls += 1; return { databaseWrites: 99 }; } });
  assert.equal(calls, 0);
  assert.deepEqual(result, { executed: false, result: null, databaseWrites: 0 });
});

test("confirmed mode invokes exactly one transaction callback", async () => {
  let calls = 0;
  const result = await executeLegacyInvoiceWriteTransaction({ confirmedWrite: true, execute: async () => { calls += 1; return { databaseWrites: 18 }; } });
  assert.equal(calls, 1);
  assert.equal(result.executed, true);
  assert.equal(result.databaseWrites, 18);
});

test("transformer keeps one Prisma transaction and no write APIs before its gate", async () => {
  const source = await readFile(new URL("./transform-invoices.mjs", import.meta.url), "utf8");
  assert.equal((source.match(/prisma\.\$transaction\(/g) ?? []).length, 1);
  const gate = source.indexOf("executeLegacyInvoiceWriteTransaction");
  const transaction = source.indexOf("prisma.$transaction(");
  assert.ok(gate >= 0 && transaction > gate);
});
