import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEVELOPMENT_PROJECT_REF, PRODUCTION_PROJECT_REF, PRODUCTION_MONITOR_EMAIL,
  PRODUCTION_WRITE_CONFIRMATION, ProductionSetupStageError,
  inProductionStage, installProductionSetupEnvironment, loadProductionSetupEnvironment,
  parseProductionSetup, productionFailureLines, setupProductionMonitor,
  validateProductionSetupTarget,
} from "../scripts/lib/prod-plumservice-setup.mjs";

function config(overrides = {}) {
  return {
    DATABASE_URL: `postgresql://postgres:example@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
    DIRECT_URL: `postgresql://postgres:example@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    SUPABASE_SECRET_KEY: "sb_secret_production_example",
    MONITOR_USER_EMAIL: PRODUCTION_MONITOR_EMAIL,
    MONITOR_USER_PASSWORD: "example-password",
    ...overrides,
  };
}

function withConfigFile(values, inspect) {
  const directory = mkdtempSync(join(tmpdir(), "prod-plumservice-test-"));
  const file = join(directory, ".env.production.monitor.local");
  try {
    writeFileSync(file, Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n"));
    return inspect(file);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function fixture(existing = false, membership = null) {
  const calls = { createUser: 0, createMembership: 0, updateMembership: 0, messages: [] };
  const user = { id: "00000000-0000-4000-8000-000000000001", email: PRODUCTION_MONITOR_EMAIL, user_metadata: { account_type: "monitoring", name: "plumservice" } };
  const auth = { admin: {
    listUsers: async () => ({ data: { users: existing ? [user] : [] }, error: null }),
    createUser: async (input) => {
      calls.createUser++;
      assert.deepEqual(input, { email: PRODUCTION_MONITOR_EMAIL, password: "example-password", email_confirm: true, user_metadata: { account_type: "monitoring", name: "plumservice" } });
      return { data: { user }, error: null };
    },
  } };
  const db = {
    shop: { findMany: async () => [{ id: "one-production-shop" }] },
    shopMembership: {
      findFirst: async () => membership ? { userId: user.id } : null,
      findMany: async () => membership ? [membership] : [],
      create: async ({ data }) => { calls.createMembership++; assert.equal(data.role, "MONITOR"); membership = data; },
      updateMany: async ({ data }) => { calls.updateMembership++; membership.userEmail = data.userEmail; return { count: 1 }; },
    },
  };
  return { db, auth, calls, logger: (message) => calls.messages.push(message) };
}

function input(write = false) {
  return { verifiedProjectRef: PRODUCTION_PROJECT_REF, email: PRODUCTION_MONITOR_EMAIL, password: "example-password", write };
}

test("production setup defaults to dry run and requires an exact write phrase", () => {
  assert.equal(parseProductionSetup([], config()).write, false);
  assert.equal(parseProductionSetup(["--confirm", PRODUCTION_WRITE_CONFIRMATION], config()).write, true);
  assert.throws(() => parseProductionSetup(["--confirm", "wrong"], config()), { stage: "environment_validation" });
});

test("exported DEV values cannot override the explicit production file", () => {
  const names = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "MONITOR_USER_PASSWORD"];
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.DATABASE_URL = `postgresql://postgres:example@db.${DEVELOPMENT_PROJECT_REF}.supabase.co/postgres`;
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${DEVELOPMENT_PROJECT_REF}.supabase.co`;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_ambient_dev_example";
    process.env.MONITOR_USER_PASSWORD = "ambient-dev-password";
    withConfigFile(config(), (file) => {
      const { env, target, isolatedEnv } = loadProductionSetupEnvironment(file);
      assert.equal(target.projectRef, PRODUCTION_PROJECT_REF);
      assert.equal(env.DATABASE_URL, config().DATABASE_URL);
      const runtimeEnv = { ...process.env };
      installProductionSetupEnvironment(isolatedEnv, runtimeEnv);
      assert.equal(runtimeEnv.DATABASE_URL, config().DATABASE_URL);
      assert.equal(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL, config().NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(runtimeEnv.SUPABASE_SECRET_KEY, config().SUPABASE_SECRET_KEY);
      assert.equal(runtimeEnv.MONITOR_USER_PASSWORD, config().MONITOR_USER_PASSWORD);
      assert.equal(JSON.stringify(runtimeEnv).includes(DEVELOPMENT_PROJECT_REF), false);
      assert.equal(JSON.stringify(runtimeEnv).includes("ambient-dev-password"), false);
    });
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
});

test("DEV and mismatched database or Supabase targets are rejected", () => {
  const cases = [
    { DATABASE_URL: `postgresql://postgres:example@db.${DEVELOPMENT_PROJECT_REF}.supabase.co/postgres` },
    { DIRECT_URL: `postgresql://postgres:example@db.${DEVELOPMENT_PROJECT_REF}.supabase.co/postgres` },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${DEVELOPMENT_PROJECT_REF}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_URL: "https://anotherprojectref.supabase.co" },
    { DATABASE_URL: `postgresql://postgres:example@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres?note=${DEVELOPMENT_PROJECT_REF}` },
  ];
  for (const overrides of cases) withConfigFile(config(overrides), (file) => {
    assert.throws(() => loadProductionSetupEnvironment(file), { stage: "environment_validation" });
  });
  assert.equal(validateProductionSetupTarget(config()).projectRef, PRODUCTION_PROJECT_REF);
});

test("dry run performs no Auth or membership writes", async () => {
  const f = fixture();
  await setupProductionMonitor({ ...f, ...input() });
  assert.equal(f.calls.createUser, 0);
  assert.equal(f.calls.createMembership, 0);
  assert.equal(f.calls.updateMembership, 0);
  assert.match(f.calls.messages.join(" "), /would be created/);
  assert.doesNotMatch(f.calls.messages.join(" "), /example-password|sb_secret|postgresql:/);
});

test("existing monitoring account is reused without duplicate writes", async () => {
  const f = fixture(true);
  const first = await setupProductionMonitor({ ...f, ...input(true) });
  const second = await setupProductionMonitor({ ...f, ...input(true) });
  assert.equal(first.membershipAction, "create");
  assert.equal(second.membershipAction, "none");
  assert.equal(f.calls.createUser, 0);
  assert.equal(f.calls.createMembership, 1);
});

test("write mode uses confirmed password Auth creation and MONITOR membership only", async () => {
  const f = fixture();
  const result = await setupProductionMonitor({ ...f, ...input(true) });
  assert.equal(result.authCreated, true);
  assert.equal(f.calls.createUser, 1);
  assert.equal(f.calls.createMembership, 1);
});

test("production setup cannot repurpose DEV or ordinary staff memberships", async () => {
  const f = fixture();
  await assert.rejects(setupProductionMonitor({ ...f, ...input(), verifiedProjectRef: DEVELOPMENT_PROJECT_REF }), { stage: "environment_validation" });
  assert.equal(f.calls.createUser, 0);
  const g = fixture(true, { shopId: "one-production-shop", role: "OWNER", userEmail: PRODUCTION_MONITOR_EMAIL });
  await assert.rejects(setupProductionMonitor({ ...g, ...input(true) }), { stage: "setup_plan" });
  assert.equal(g.calls.createUser, 0);
  assert.equal(g.calls.createMembership, 0);
  assert.equal(g.calls.updateMembership, 0);
});

test("fixed failure output never includes secrets or raw errors", async () => {
  const raw = "postgresql://private-host/db Authorization: Bearer sb_secret_private password=private";
  for (const stage of ["environment_validation", "supabase_admin_client", "auth_user_lookup", "production_shop_lookup", "existing_membership_lookup", "setup_plan"]) {
    let error;
    try { await inProductionStage(stage, () => { throw new Error(raw); }); }
    catch (caught) { error = caught; }
    const output = productionFailureLines(error).join("\n");
    assert.match(output, new RegExp(`failed during: ${stage}`));
    for (const secret of [raw, "private-host", "Bearer", "sb_secret_private", "password=private"]) assert.equal(output.includes(secret), false);
  }
  assert.equal(new ProductionSetupStageError(raw).stage, "setup_plan");
  const source = readFileSync(new URL("../scripts/setup-prod-plumservice.mjs", import.meta.url), "utf8");
  assert.match(source, /loadProductionSetupEnvironment/);
  assert.match(source, /installProductionSetupEnvironment\(isolatedEnv\)/);
  assert.match(source, /createClient\(env\.NEXT_PUBLIC_SUPABASE_URL, env\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
});
