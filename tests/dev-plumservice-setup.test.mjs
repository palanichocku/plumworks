import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MONITOR_EMAIL, WRITE_CONFIRMATION, SetupStageError, inSetupStage, installDevelopmentSetupEnvironment, loadDevelopmentSetupEnvironment, setupFailureLines, parseMonitorSetup, setupDevMonitor, membershipPlan } from "../scripts/lib/dev-plumservice-setup.mjs";
import { validateDevelopmentDatabaseTarget, PROTECTED_SUPABASE_PROJECTS } from "../scripts/lib/development-database-target.mjs";

const matrix = JSON.parse(await readFile(new URL("../src/lib/permission-matrix.json", import.meta.url), "utf8"));
const forbidden = ["manage_marketing_leads", "view_reports", "view_search", "edit_customer_vehicle", "create_repair_order", "edit_draft_repair_order", "void_repair_order", "finalize_repair_order", "record_payment", "edit_shop_settings", "manage_canned_services", "view_audit_log", "manage_staff", "export_shop_data"];

test("MONITOR has exactly the two required view permissions", () => {
  assert.deepEqual([...matrix.MONITOR].sort(), ["view_dashboard", "view_marketing_leads"].sort());
  for (const permission of forbidden) assert.equal(matrix.MONITOR.includes(permission), false, permission);
});

test("setup defaults to dry run and requires the exact write phrase", () => {
  const env = { MONITOR_USER_EMAIL: MONITOR_EMAIL, MONITOR_USER_PASSWORD: "test-secret" };
  assert.equal(parseMonitorSetup([], env).write, false);
  assert.equal(parseMonitorSetup(["--confirm", WRITE_CONFIRMATION], env).write, true);
  assert.throws(() => parseMonitorSetup(["--confirm", "wrong"], env));
  assert.throws(() => parseMonitorSetup([], { ...env, MONITOR_USER_EMAIL: "other@example.test" }));
});

function fixture({ existing = false, membership = null } = {}) {
  const calls = { createUser: 0, createMembership: 0, updateMembership: 0, log: [] };
  const user = { id: "00000000-0000-4000-8000-000000000001", email: MONITOR_EMAIL, user_metadata: { account_type: "monitoring", name: "plumservice" } };
  const auth = { admin: {
    listUsers: async () => ({ data: { users: existing ? [user] : [] }, error: null }),
    createUser: async (input) => { calls.createUser++; assert.deepEqual(input, { email: MONITOR_EMAIL, password: "test-secret", email_confirm: true, user_metadata: { account_type: "monitoring", name: "plumservice" } }); return { data: { user }, error: null }; },
  } };
  const db = {
    shop: { findMany: async () => [{ id: "shop-dev" }] },
    shopMembership: {
      findFirst: async () => membership ? { userId: user.id } : null,
      findMany: async () => membership ? [membership] : [],
      create: async ({ data }) => { calls.createMembership++; assert.equal(data.role, "MONITOR"); membership = { ...data }; },
      updateMany: async ({ where, data }) => { calls.updateMembership++; assert.equal(where.role, "MONITOR"); membership.userEmail = data.userEmail; return { count: 1 }; },
    },
  };
  return { db, auth, calls, user, logger: (message) => calls.log.push(message) };
}

test("dry run does not create Auth users or memberships and does not log secrets", async () => {
  const f = fixture();
  await setupDevMonitor({ ...f, email: MONITOR_EMAIL, password: "test-secret", write: false });
  assert.equal(f.calls.createUser, 0);
  assert.equal(f.calls.createMembership, 0);
  assert.doesNotMatch(f.calls.log.join(" "), /test-secret|service-role|postgres:/);
});

test("write mode refuses a missing admin client before creating Auth users", async () => {
  const f = fixture();
  await assert.rejects(setupDevMonitor({ ...f, auth: null, email: MONITOR_EMAIL, password: "test-secret", write: true }), /SUPABASE_SECRET_KEY/);
  assert.equal(f.calls.createUser, 0);
  assert.equal(f.calls.createMembership, 0);
});

test("existing monitor account is reused and membership setup is idempotent", async () => {
  const f = fixture({ existing: true });
  const first = await setupDevMonitor({ ...f, email: MONITOR_EMAIL, password: "test-secret", write: true });
  const second = await setupDevMonitor({ ...f, email: MONITOR_EMAIL, password: "test-secret", write: true });
  assert.equal(first.membershipAction, "create");
  assert.equal(second.membershipAction, "none");
  assert.equal(f.calls.createUser, 0);
  assert.equal(f.calls.createMembership, 1);
});

test("new Auth account is created once with confirmed email and metadata", async () => {
  const f = fixture();
  const result = await setupDevMonitor({ ...f, email: MONITOR_EMAIL, password: "test-secret", write: true });
  assert.equal(result.authCreated, true);
  assert.equal(f.calls.createUser, 1);
  assert.equal(f.calls.createMembership, 1);
  assert.doesNotMatch(f.calls.log.join(" "), /test-secret/);
});

test("membership updates only an existing MONITOR email; other roles are rejected", async () => {
  const f = fixture({ existing: true, membership: { shopId: "shop-dev", role: "MONITOR", userEmail: "old@example.test" } });
  const result = await setupDevMonitor({ ...f, email: MONITOR_EMAIL, password: "test-secret", write: true });
  assert.equal(result.membershipAction, "update-email");
  assert.equal(f.calls.updateMembership, 1);
  assert.throws(() => membershipPlan([{ shopId: "shop-dev", role: "OWNER" }], null, "shop-dev", f.user.id, MONITOR_EMAIL));
  assert.throws(() => membershipPlan([], { userId: "someone-else" }, "shop-dev", f.user.id, MONITOR_EMAIL));
});

test("an existing ordinary Auth account cannot be repurposed", async () => {
  const f = fixture({ existing: true });
  f.auth.admin.listUsers = async () => ({ data: { users: [{ ...f.user, user_metadata: { name: "ordinary staff" } }] }, error: null });
  await assert.rejects(setupDevMonitor({ ...f, email: MONITOR_EMAIL, password: "test-secret", write: true }), { stage: "auth_user_lookup" });
  assert.equal(f.calls.createUser, 0);
  assert.equal(f.calls.createMembership, 0);
});

test("stage formatter emits only fixed stage and generic lines despite secret-filled errors", async () => {
  const secret = "sb_secret_should-never-appear";
  const raw = `postgresql://private-host/db Authorization: Bearer ${secret} password=private`;
  for (const stage of ["environment_validation", "supabase_admin_client", "auth_user_lookup", "dev_shop_lookup", "existing_membership_lookup", "setup_plan"]) {
    let error;
    try { await inSetupStage(stage, () => { throw new Error(raw); }); }
    catch (caught) { error = caught; }
    assert.equal(error?.stage, stage);
    const output = setupFailureLines(error).join("\n");
    assert.match(output, new RegExp(`failed during: ${stage}`));
    assert.match(output, /Check the guarded target/);
    for (const value of [secret, raw, "private-host", "Bearer", "password=private"]) assert.equal(output.includes(value), false);
  }
  assert.equal(setupFailureLines(new Error(raw))[0], "DEV plumservice setup failed during: setup_plan");
  assert.equal(new SetupStageError(raw).stage, "setup_plan");
});

test("lookup failures are classified without propagating raw response details", async () => {
  const secret = "sb_secret_private";
  const f = fixture();
  f.db.shop.findMany = async () => { throw new Error(secret); };
  await assert.rejects(setupDevMonitor({ ...f, email: MONITOR_EMAIL, password: "test-secret", write: false }), { stage: "dev_shop_lookup" });
  const g = fixture();
  g.auth.admin.listUsers = async () => { throw new Error(secret); };
  await assert.rejects(setupDevMonitor({ ...g, email: MONITOR_EMAIL, password: "test-secret", write: false }), { stage: "auth_user_lookup" });
  const h = fixture();
  h.db.shopMembership.findFirst = async () => { throw new Error(secret); };
  await assert.rejects(setupDevMonitor({ ...h, email: MONITOR_EMAIL, password: "test-secret", write: false }), { stage: "existing_membership_lookup" });
});

test("production target is rejected before setup", () => {
  const ref = PROTECTED_SUPABASE_PROJECTS.production;
  assert.throws(() => validateDevelopmentDatabaseTarget({
    PLUMWORKS_DEV_SUPABASE_PROJECT_REF: ref,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test",
    DATABASE_URL: `postgresql://postgres:secret@db.${ref}.supabase.co/postgres`,
    DIRECT_URL: `postgresql://postgres:secret@db.${ref}.supabase.co/postgres`,
  }), /Refusing protected production/);
});

const devRef = "qchvjaqwanyimkidlqqu";
const productionRef = PROTECTED_SUPABASE_PROJECTS.production;
function setupEnv(overrides = {}) {
  return {
    PLUMWORKS_DEV_SUPABASE_PROJECT_REF: devRef,
    DATABASE_URL: `postgresql://postgres:example@db.${devRef}.supabase.co/postgres`,
    DIRECT_URL: `postgresql://postgres:example@db.${devRef}.supabase.co/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${devRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "example-anon",
    SUPABASE_SECRET_KEY: "sb_secret_dev_example",
    MONITOR_USER_EMAIL: MONITOR_EMAIL,
    MONITOR_USER_PASSWORD: "example-monitor-password",
    ...overrides,
  };
}

function withSetupEnvFile(values, check) {
  const directory = mkdtempSync(join(tmpdir(), "plumservice-setup-test-"));
  const file = join(directory, ".env.development.local");
  try {
    writeFileSync(file, Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n"));
    return check(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("explicit DEV file overrides exported production targets before client use", () => {
  const names = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.DATABASE_URL = `postgresql://postgres:example@db.${productionRef}.supabase.co/postgres`;
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${productionRef}.supabase.co`;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_ambient_production_example";
    withSetupEnvFile(setupEnv(), (file) => {
      const { env, target, isolatedEnv } = loadDevelopmentSetupEnvironment(file);
      assert.equal(target.projectRef, devRef);
      assert.equal(env.DATABASE_URL, setupEnv().DATABASE_URL);
      assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, setupEnv().NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(env.SUPABASE_SECRET_KEY, setupEnv().SUPABASE_SECRET_KEY);
      const runtimeEnv = { ...process.env };
      installDevelopmentSetupEnvironment(isolatedEnv, runtimeEnv);
      assert.equal(runtimeEnv.DATABASE_URL, env.DATABASE_URL);
      assert.equal(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(runtimeEnv.SUPABASE_SECRET_KEY, env.SUPABASE_SECRET_KEY);
      assert.equal(JSON.stringify(runtimeEnv).includes(productionRef), false);
      assert.equal(JSON.stringify(runtimeEnv).includes("sb_secret_ambient_production_example"), false);
    });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("DEV file rejects production and mismatched target values before client use", () => {
  const cases = [
    { DATABASE_URL: `postgresql://postgres:example@db.${productionRef}.supabase.co/postgres` },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_URL: "https://anotherdevelopmentref.supabase.co" },
    { DATABASE_URL: `postgresql://postgres:example@db.${devRef}.supabase.co/postgres?note=${productionRef}` },
  ];
  for (const overrides of cases) {
    withSetupEnvFile(setupEnv(overrides), (file) => {
      assert.throws(() => loadDevelopmentSetupEnvironment(file), /different Supabase project|Refusing protected production|DEV setup stage failed/);
    });
  }
});

test("DEV secret key is consumed only by the server-side setup entry point and never logged", async () => {
  const source = await readFile(new URL("../scripts/setup-dev-plumservice.mjs", import.meta.url), "utf8");
  const helperSource = await readFile(new URL("../scripts/lib/dev-plumservice-setup.mjs", import.meta.url), "utf8");
  assert.match(helperSource, /validateDevelopmentDatabaseTarget\(env\)/);
  assert.match(source, /createClient\(env\.NEXT_PUBLIC_SUPABASE_URL, env\.SUPABASE_SECRET_KEY/);
  assert.match(source, /detectSessionInUrl: false \} \}\)\.auth/);
  assert.match(source, /installDevelopmentSetupEnvironment\(isolatedEnv\)/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*env\.SUPABASE_SECRET_KEY/);
});
