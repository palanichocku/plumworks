import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [createEvidenceMigration, accessHardeningMigration, immutabilityMigration] = await Promise.all([
  read("prisma/migrations/20261012170000_add_authorization_evidence/migration.sql"),
  read("prisma/migrations/20261014184500_harden_authorization_evidence_access/migration.sql"),
  read("prisma/migrations/20261023180000_enforce_authorization_evidence_immutability/migration.sql"),
]);

test("evidence tables keep restrictive foreign keys instead of cascade deletion", () => {
  for (const table of ["document_revisions", "authorization_events", "signature_evidence"]) {
    assert.match(createEvidenceMigration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.doesNotMatch(createEvidenceMigration, /document_revisions[\s\S]*ON DELETE CASCADE/);
  assert.doesNotMatch(createEvidenceMigration, /authorization_events[\s\S]*ON DELETE CASCADE/);
  assert.doesNotMatch(createEvidenceMigration, /signature_evidence[\s\S]*ON DELETE CASCADE/);
});

test("evidence tables remain protected from anon and authenticated roles", () => {
  for (const table of ["document_revisions", "authorization_requests", "authorization_events", "signature_evidence"]) {
    assert.match(accessHardeningMigration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(accessHardeningMigration, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`));
  }
});

test("immutable evidence tables reject UPDATE and DELETE at the database layer", () => {
  assert.match(immutabilityMigration, /CREATE OR REPLACE FUNCTION public\.reject_authorization_evidence_mutation\(\)/);
  assert.match(immutabilityMigration, /RAISE EXCEPTION 'immutable authorization evidence:/);

  for (const [table, trigger] of [
    ["document_revisions", "document_revisions_immutable"],
    ["authorization_events", "authorization_events_immutable"],
    ["signature_evidence", "signature_evidence_immutable"],
  ]) {
    assert.match(immutabilityMigration, new RegExp(`CREATE TRIGGER ${trigger}`));
    assert.match(
      immutabilityMigration,
      new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${table}[\\s\\S]*EXECUTE FUNCTION public\\.reject_authorization_evidence_mutation\\(\\)`),
    );
  }
});

test("authorization request lifecycle remains mutable", () => {
  assert.doesNotMatch(immutabilityMigration, /BEFORE UPDATE OR DELETE ON public\.authorization_requests/);
  assert.match(
    createEvidenceMigration,
    /AuthorizationRequestStatus" AS ENUM \('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED', 'REVOKED', 'SUPERSEDED'\)/,
  );
});
