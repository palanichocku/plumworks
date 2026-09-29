import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  APPROVED_DEVELOPMENT_REF_VARIABLE,
  createDevelopmentChildEnvironment,
  DEVELOPMENT_ENV_FILE,
  PROTECTED_SUPABASE_PROJECTS,
  readEnvironmentFile,
  validateDevelopmentDatabaseTarget,
} from "../scripts/lib/development-database-target.mjs";
import { commandPlan } from "../scripts/dev-database-command.mjs";

const developmentRef = "devprojectref12345678";
const databaseUrl = (ref = developmentRef) => `postgresql://postgres.${ref}:dev-db-password@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true`;
const directUrl = (ref = developmentRef) => `postgresql://postgres:dev-direct-password@db.${ref}.supabase.co:5432/postgres`;
const apiUrl = (ref = developmentRef) => `https://${ref}.supabase.co`;
const validEnvironment = (overrides = {}) => ({
  [APPROVED_DEVELOPMENT_REF_VARIABLE]: developmentRef,
  DATABASE_URL: databaseUrl(),
  DIRECT_URL: directUrl(),
  NEXT_PUBLIC_SUPABASE_URL: apiUrl(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-key",
  ...overrides,
});

test("the explicitly approved development project's three target identities pass", () => {
  assert.deepEqual(validateDevelopmentDatabaseTarget(validEnvironment()), { projectRef: developmentRef });
});

test("production and restore-rehearsal targets are rejected by protected environment name", () => {
  for (const [name, ref] of Object.entries(PROTECTED_SUPABASE_PROJECTS)) {
    const env = validEnvironment({
      DIRECT_URL: directUrl(ref),
      NEXT_PUBLIC_SUPABASE_URL: apiUrl(ref),
    });
    assert.throws(() => validateDevelopmentDatabaseTarget(env), new RegExp(`protected ${name} Supabase project target`));
  }
  for (const [name, ref] of Object.entries(PROTECTED_SUPABASE_PROJECTS)) {
    assert.throws(() => validateDevelopmentDatabaseTarget(validEnvironment({
      [APPROVED_DEVELOPMENT_REF_VARIABLE]: ref,
    })), new RegExp(`protected ${name} Supabase project target`));
  }
});

test("missing runtime and migration database variables fail closed", () => {
  for (const name of ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    const env = validEnvironment();
    delete env[name];
    assert.throws(() => validateDevelopmentDatabaseTarget(env), new RegExp(`missing ${name}`));
  }
  const missingAnonKey = validEnvironment();
  delete missingAnonKey.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.throws(() => validateDevelopmentDatabaseTarget(missingAnonKey), /missing NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test("each database URL and the Supabase API URL must match the approved project", () => {
  assert.throws(() => validateDevelopmentDatabaseTarget(validEnvironment({ DATABASE_URL: databaseUrl("otherdevproject123456") })), /different Supabase project/);
  assert.throws(() => validateDevelopmentDatabaseTarget(validEnvironment({ DIRECT_URL: directUrl("otherdevproject123456") })), /different Supabase project/);
  assert.throws(() => validateDevelopmentDatabaseTarget(validEnvironment({ NEXT_PUBLIC_SUPABASE_URL: apiUrl("otherdevproject123456") })), /different Supabase project/);
});

test("development file values override ambient production values and ambient secrets are not copied", () => {
  const dev = validEnvironment({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" });
  const ambient = {
    PATH: "/usr/bin",
    DATABASE_URL: databaseUrl(PROTECTED_SUPABASE_PROJECTS.production),
    DIRECT_URL: directUrl(PROTECTED_SUPABASE_PROJECTS.production),
    NEXT_PUBLIC_SUPABASE_URL: apiUrl(PROTECTED_SUPABASE_PROJECTS.production),
    SUPABASE_SERVICE_ROLE_KEY: "ambient-production-secret",
    RESEND_API_KEY: "ambient-production-email-secret",
  };
  const child = createDevelopmentChildEnvironment(dev, ambient, ["DATABASE_URL", "DIRECT_URL", "RESEND_API_KEY", "EMAIL_PASSWORD"]);
  assert.equal(child.DATABASE_URL, dev.DATABASE_URL);
  assert.equal(child.DIRECT_URL, dev.DIRECT_URL);
  assert.equal(child.NEXT_PUBLIC_SUPABASE_URL, dev.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(child.RESEND_API_KEY, "");
  assert.equal(child.EMAIL_PASSWORD, "");
  assert.equal("SUPABASE_SERVICE_ROLE_KEY" in child, false);
  assert.equal(child.NODE_ENV, "development");
});

test("malformed, non-Supabase, and unverifiable database URLs fail closed", () => {
  for (const value of ["not-a-url", "postgresql://user:secret@localhost:5432/postgres", "https://db.example.invalid/postgres"]) {
    assert.throws(() => validateDevelopmentDatabaseTarget(validEnvironment({ DATABASE_URL: value })));
  }
  assert.throws(() => validateDevelopmentDatabaseTarget(validEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid" })), /verifiable Supabase project/);
});

test("error messages never include database URL credentials", () => {
  const secret = "do-not-leak-this-password";
  const env = validEnvironment({
    DATABASE_URL: `postgresql://postgres.${PROTECTED_SUPABASE_PROJECTS.production}:${secret}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
  });
  let message = "";
  try { validateDevelopmentDatabaseTarget(env); } catch (error) { message = error.message; }
  assert.match(message, /protected production Supabase project target/);
  assert.doesNotMatch(message, new RegExp(secret));
  assert.doesNotMatch(message, /postgresql:\/\//);
});

test("the development env file loads without leaking values and the approved project ref is explicit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plumworks-dev-env-"));
  const file = join(directory, DEVELOPMENT_ENV_FILE);
  const sentinel = "file-secret-must-not-be-printed";
  try {
    await writeFile(file, `DATABASE_URL=${databaseUrl()}\nDIRECT_URL=${directUrl()}\nNEXT_PUBLIC_SUPABASE_URL=${apiUrl()}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-public-key\n${APPROVED_DEVELOPMENT_REF_VARIABLE}=${developmentRef}\nTEST_SECRET=${sentinel}\n`);
    const env = readEnvironmentFile(file);
    assert.equal(env.TEST_SECRET, sentinel);
    assert.deepEqual(validateDevelopmentDatabaseTarget(env), { projectRef: developmentRef });
    assert.doesNotMatch(JSON.stringify(env).replaceAll(sentinel, ""), new RegExp(sentinel));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("development command plans are fixed and never invoke schema creation, reset, or seed shortcuts", () => {
  assert.deepEqual(commandPlan("status"), [commandPlan("status")[0], "migrate", "status"]);
  assert.deepEqual(commandPlan("migrate"), [commandPlan("migrate")[0], "migrate", "deploy"]);
  assert.deepEqual(commandPlan("generate"), [commandPlan("generate")[0], "generate"]);
  assert.match(commandPlan("setup", ["--dry-run"])[0], /setup-client\.mjs$/);
  for (const operation of ["status", "migrate", "generate"]) {
    const plan = commandPlan(operation).join(" ");
    assert.doesNotMatch(plan, /migrate dev|db push|reset|seed/i);
    assert.throws(() => commandPlan(operation, ["--schema=other.prisma"]), /do not accept argument overrides/);
  }
});

test("the local development environment file remains ignored", async () => {
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^\.env\.\*$/m);
});
