import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { createServerClient } from "@supabase/ssr";
import * as governance from "../src/lib/staff-governance.ts";
import * as audit from "../src/lib/audit.ts";
import * as identity from "../src/lib/staff-invite-identity.ts";
import * as invitation from "../src/lib/auth/staff-invitation.ts";
import * as recovery from "../src/lib/auth/password-recovery.ts";

// Execute the actual actions/routes with isolated imports: no DB, Auth, or email I/O.
async function load(path, imports) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", outputText)((name) => {
    assert.ok(name in imports, `unexpected dependency: ${name}`);
    return imports[name];
  }, loaded, loaded.exports, { env: { NEXT_PUBLIC_SITE_URL: "https://shop.example.com" } });
  return loaded.exports;
}

const shopId = "00000000-0000-4000-8000-000000000001";
const otherShopId = "00000000-0000-4000-8000-000000000002";
const inviteId = "00000000-0000-4000-8000-000000000003";
const userId = "00000000-0000-4000-8000-000000000004";
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
const pendingInvite = (overrides = {}) => ({ id: inviteId, shopId, email: "staff@example.com", role: "STAFF", status: "pending", ...overrides });

async function fixture(options = {}) {
  let state = { invites: options.invites ?? [], members: options.members ?? [], audits: [] };
  const calls = { sends: 0, locks: [], isolation: [] };
  const user = options.user ?? { id: userId, email: " Staff@Example.com ", email_confirmed_at: "2026-01-01T00:00:00Z" };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === "shopId_email") return matches(row, value);
    if (value && typeof value === "object" && "equals" in value) return row[key]?.toLowerCase() === value.equals.toLowerCase();
    return row[key] === value;
  });
  let queue = Promise.resolve();
  const prisma = { $transaction: async (callback, settings) => {
    const previous = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    const draft = structuredClone(state);
    calls.isolation.push(settings?.isolationLevel);
    const tx = {
      $queryRaw: async (strings) => { calls.locks.push(strings.join("?")); return []; },
      staffInvite: {
        findUnique: async ({ where }) => draft.invites.find((row) => matches(row, where)) ?? null,
        findFirst: async ({ where }) => draft.invites.find((row) => matches(row, where)) ?? null,
        upsert: async ({ where, update, create }) => {
          let row = draft.invites.find((row) => matches(row, where));
          if (row) Object.assign(row, update);
          else { row = { id: randomUUID(), status: "pending", ...create }; draft.invites.push(row); }
          return row;
        },
        update: async ({ where, data }) => Object.assign(draft.invites.find((row) => matches(row, where)), data),
        updateMany: async ({ where, data }) => {
          const rows = draft.invites.filter((row) => matches(row, where));
          rows.forEach((row) => Object.assign(row, data));
          return { count: rows.length };
        },
      },
      shopMembership: {
        findFirst: async ({ where }) => draft.members.find((row) => matches(row, where)) ?? null,
        create: async ({ data }) => {
          if (options.failMembership) throw new Error("membership failed");
          const row = { id: randomUUID(), ...data }; draft.members.push(row); return row;
        },
      },
      auditLog: { create: async ({ data }) => {
        if (options.failAudit) throw new Error("audit failed");
        draft.audits.push(data); return data;
      } },
    };
    try { const result = await callback(tx); state = draft; return result; }
    finally { release(); }
  } };
  const roles = { OWNER: "OWNER", ADMIN: "ADMIN", STAFF: "STAFF" };
  const membership = options.noMembership ? null : { shopId, role: options.role ?? "OWNER" };
  const matrix = JSON.parse(await readFile(new URL("../src/lib/permission-matrix.json", import.meta.url), "utf8"));
  const permissions = await load("src/lib/permissions.ts", {
    "server-only": {}, "@/lib/permission-matrix.json": matrix,
    "@/lib/data/membership": { getCurrentMembership: async () => ({ user, membership }) },
  });
  const imports = {
    "next/cache": { revalidatePath() {} }, "node:crypto": { randomUUID },
    "next/navigation": { redirect: (path) => { throw new Error(`redirect:${path}`); } },
    "@/generated/prisma/client": { ShopMembershipRole: roles },
    "@/lib/audit": audit, "@/lib/prisma": { prisma }, "@/lib/permissions": permissions,
    "@/lib/staff-governance": governance, "@/lib/staff-invite-identity": identity,
    "@/lib/auth/staff-invitation": invitation,
    "@/lib/supabase/admin": { createAdminClient: () => ({ auth: { admin: { inviteUserByEmail: async () => {
      calls.sends += 1; return { error: options.deliveryError ?? null };
    } } } }) },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
  };
  const staff = await load("src/app/(app)/admin/staff/actions.ts", imports);
  const accept = await load("src/app/invite/actions.ts", imports);
  return { state: () => state, calls, staff, accept: () => accept.acceptStaffInvite(form({ inviteId: options.acceptId ?? inviteId })) };
}

for (const role of ["OWNER", "ADMIN"]) test(`${role} creates a scoped invite, sends email, and records governance audit`, async () => {
  const f = await fixture({ role });
  const result = await f.staff.createStaffInvite({}, form({ email: " STAFF@EXAMPLE.COM ", role: role === "OWNER" ? "OWNER" : "STAFF", shopId: otherShopId }));
  assert.equal(result.status, "success");
  assert.equal(f.state().invites[0].shopId, shopId);
  assert.equal(f.state().invites[0].email, "staff@example.com");
  assert.equal(f.state().audits[0].action, "staff_invite_created");
  assert.equal(f.calls.sends, 1);
});

test("STAFF and authenticated users without membership cannot invite", async () => {
  for (const options of [{ role: "STAFF" }, { noMembership: true }]) {
    const f = await fixture(options);
    await assert.rejects(f.staff.createStaffInvite({}, form({ email: "staff@example.com", role: "STAFF" })), /permission/);
    assert.equal(f.calls.sends, 0); assert.equal(f.state().invites.length, 0);
  }
});

test("pending retry and concurrent submissions reuse one ID and creation audit", async () => {
  const f = await fixture();
  const send = () => f.staff.createStaffInvite({}, form({ email: "staff@example.com", role: "STAFF" }));
  await Promise.all([send(), send()]);
  const id = f.state().invites[0].id;
  await send();
  assert.equal(f.state().invites.length, 1); assert.equal(f.state().invites[0].id, id);
  assert.equal(f.state().audits.length, 1); assert.equal(f.calls.sends, 3);
  assert.ok(f.calls.locks.some((sql) => /FROM shops.*FOR UPDATE/.test(sql)));
});

test("failed email leaves pending invite and failure audit; confirmed account reports sign-in without claiming email", async () => {
  for (const deliveryError of [{ code: "unexpected_failure" }, { code: "email_exists" }]) {
    const f = await fixture({ deliveryError });
    const result = await f.staff.createStaffInvite({}, form({ email: "staff@example.com", role: "STAFF" }));
    assert.equal(f.state().invites[0].status, "pending");
    assert.equal(result.status, deliveryError.code === "email_exists" ? "success" : "error");
    assert.equal(f.state().audits.filter((a) => a.action === "staff_invite_delivery_failed").length, deliveryError.code === "email_exists" ? 0 : 1);
    if (deliveryError.code === "email_exists") assert.match(result.message, /no invitation email was sent.*sign in/);
  }
});

test("ADMIN cannot grant, replace, or revoke OWNER invitations", async () => {
  const f = await fixture({ role: "ADMIN", invites: [pendingInvite({ role: "OWNER" })] });
  for (const role of ["OWNER", "STAFF"]) await assert.rejects(f.staff.createStaffInvite({}, form({ email: "staff@example.com", role })), /Only an owner/);
  await assert.rejects(f.staff.revokeStaffInvite(form({ inviteId })), /Only an owner/);
  assert.equal(f.state().invites[0].role, "OWNER"); assert.equal(f.calls.sends, 0);
});

test("pending role is immutable on retry; cross-shop revocation fails", async () => {
  const f = await fixture({ invites: [pendingInvite()] });
  await assert.rejects(f.staff.createStaffInvite({}, form({ email: "staff@example.com", role: "ADMIN" })), /Revoke/);
  const other = await fixture({ invites: [pendingInvite({ shopId: otherShopId })] });
  await assert.rejects(other.staff.revokeStaffInvite(form({ inviteId })), /not found/);
  assert.equal(other.state().invites[0].status, "pending"); assert.equal(other.state().audits.length, 0);
});

test("re-inviting former staff uses a fresh acceptance ID; active member cannot reopen invite", async () => {
  for (const status of ["accepted", "revoked"]) {
    const f = await fixture({ invites: [pendingInvite({ status })], deliveryError: { code: "email_exists" } });
    await f.staff.createStaffInvite({}, form({ email: "staff@example.com", role: "STAFF" }));
    assert.notEqual(f.state().invites[0].id, inviteId); assert.equal(f.state().invites[0].status, "pending");
    await assert.rejects(f.accept(), /unavailable/);
  }
  const f = await fixture({ invites: [pendingInvite({ status: "accepted" })], members: [{ shopId, userId, userEmail: "staff@example.com" }] });
  await assert.rejects(f.staff.createStaffInvite({}, form({ email: "staff@example.com", role: "STAFF" })), /already a shop member/);
  assert.equal(f.state().invites[0].status, "accepted");
});

test("acceptance uses confirmed UUID/email and atomically writes membership, status, and audit", async () => {
  const f = await fixture({ invites: [pendingInvite()] });
  await assert.rejects(f.accept(), /redirect:\/dashboard/);
  assert.equal(f.state().members[0].userId, userId); assert.equal(f.state().members[0].shopId, shopId);
  assert.equal(f.state().invites[0].status, "accepted"); assert.equal(f.state().audits[0].action, "staff_invite_accepted");
  assert.equal(f.calls.isolation[0], "Serializable");
  assert.ok(f.calls.locks.some((sql) => /staff_invites[\s\S]*FOR UPDATE/.test(sql)));
});

test("wrong/unconfirmed email, revoked/accepted invite, and existing member cannot accept", async () => {
  const cases = [
    { user: { id: userId, email: "other@example.com", email_confirmed_at: "2026-01-01" } },
    { user: { id: userId, email: "staff@example.com", email_confirmed_at: null } },
    { invites: [pendingInvite({ status: "revoked" })] }, { invites: [pendingInvite({ status: "accepted" })] },
    { members: [{ id: "member", userId, shopId: otherShopId }] },
  ];
  for (const options of cases) {
    const f = await fixture({ invites: [pendingInvite()], ...options });
    await assert.rejects(f.accept(), /unavailable|Confirm your email|already been accepted/);
    assert.equal(f.state().audits.length, 0); assert.equal(f.state().members.length, options.members?.length ?? 0);
  }
});

test("duplicate acceptance creates one membership; failures roll back status and success audit", async () => {
  const f = await fixture({ invites: [pendingInvite()] });
  await Promise.allSettled([f.accept(), f.accept()]);
  assert.equal(f.state().members.length, 1); assert.equal(f.state().audits.length, 1);
  for (const options of [{ failMembership: true }, { failAudit: true }]) {
    const failed = await fixture({ invites: [pendingInvite()], ...options });
    await assert.rejects(failed.accept(), /failed/);
    assert.equal(failed.state().members.length, 0); assert.equal(failed.state().audits.length, 0);
    assert.equal(failed.state().invites[0].status, "pending");
  }
});

async function callback(query, options = {}) {
  const calls = { verify: [], exchange: [], cookies: [] };
  let onAuthChange;
  const route = await load("src/app/auth/callback/route.ts", {
    "next/headers": { cookies: async () => ({ delete: (name) => calls.cookies.push(["delete", name]), set: (...args) => calls.cookies.push(["set", ...args]) }) },
    "next/server": { NextResponse: { redirect: (url) => new Response(null, { status: 307, headers: { Location: url.href } }) } },
    "@/lib/auth/password-recovery": recovery, "@/lib/auth/staff-invitation": invitation,
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      verifyOtp: async (args) => { calls.verify.push(args); if (options.throws) throw new Error("private provider error"); return { error: options.error ?? null }; },
      onAuthStateChange: (listener) => { onAuthChange = listener; return { data: { subscription: { unsubscribe() {} } } }; },
      exchangeCodeForSession: async (code) => {
        calls.exchange.push(code);
        onAuthChange(options.redirectType === "signin" ? "SIGNED_IN" : "PASSWORD_RECOVERY");
        return { data: {}, error: options.error ?? null };
      },
      getUser: async () => ({ data: { user: { id: userId } }, error: options.userError ?? null }),
    } }) },
  });
  const url = new URL(`https://shop.example.com/auth/callback?${query}`);
  return { response: await route.GET({ url: url.href, nextUrl: url }), calls };
}

test("invite callback verifies the correct OTP type and clears old recovery context", async () => {
  const { response, calls } = await callback("flow=invite&next=%2Finvite&token_hash=opaque&type=invite");
  assert.deepEqual(calls.verify, [{ token_hash: "opaque", type: "invite" }]); assert.equal(calls.exchange.length, 0);
  assert.equal(response.headers.get("Location"), "https://shop.example.com/invite");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.deepEqual(calls.cookies, [["delete", recovery.RECOVERY_CONTEXT_COOKIE]]);
});

test("malformed/mixed callback and open redirects never call Auth", async () => {
  for (const query of [
    "flow=invite&next=/invite&code=opaque", "flow=invite&next=/invite&token_hash=opaque&type=recovery",
    "flow=invite&next=/invite&token_hash=opaque&type=invite&code=opaque",
    "flow=invite&next=/invite&token_hash=opaque&type=invite&type=recovery",
    "flow=invite&next=https://evil.example&token_hash=opaque&type=invite",
    "next=//evil.example&code=opaque", "next=/update-password&code=opaque&type=invite",
    "flow=invite&next=/invite", "next=/update-password&code=opaque&error=denied",
  ]) {
    const { response, calls } = await callback(query);
    assert.equal(new URL(response.headers.get("Location")).origin, "https://shop.example.com");
    assert.match(response.headers.get("Location"), /invalid/); assert.equal(calls.verify.length + calls.exchange.length, 0);
  }
});

test("recovery callback requires SDK recovery context; Auth failures fail closed", async () => {
  const valid = await callback("next=/update-password&code=opaque");
  assert.equal(valid.response.headers.get("Location"), "https://shop.example.com/update-password");
  assert.equal(valid.calls.cookies[1][0], "set"); assert.equal(valid.calls.cookies[1][3].httpOnly, true);
  const invalid = await callback("next=/update-password&code=opaque", { redirectType: "signin" });
  assert.match(invalid.response.headers.get("Location"), /invalid/); assert.equal(invalid.calls.cookies.length, 1);
  for (const options of [{ throws: true }, { error: new Error("expired") }, { userError: new Error("invalid user") }]) {
    const result = await callback("flow=invite&next=/invite&token_hash=opaque&type=invite", options);
    assert.match(result.response.headers.get("Location"), /invite=invalid/); assert.equal(result.calls.cookies.length, 1);
  }
});

test("an authenticated account without membership is denied protected app rendering", async () => {
  const layout = await load("src/app/(app)/layout.tsx", {
    "react/jsx-runtime": { jsx: () => { throw new Error("must not render app"); } },
    "next/navigation": { redirect: (path) => { throw new Error(`redirect:${path}`); } },
    "@/components/app-shell": {}, "@/lib/permissions": {},
    "@/lib/data/membership": { getCurrentMembership: async () => ({ user: { id: userId }, membership: null }) },
  });
  await assert.rejects(layout.default({ children: null }), /redirect:\/invite/);
});

test("installed Supabase SSR SDK preserves recovery verifier and session cookies with mocked HTTP", async () => {
  const jar = new Map();
  const requests = [];
  const makeClient = () => createServerClient("https://auth.example.com", "test-public-key", {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
    global: { fetch: async (url) => {
      requests.push(String(url));
      const payload = String(url).includes("/recover") ? {} : {
        access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600,
        user: { id: userId, email: "staff@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  const request = makeClient();
  assert.equal((await request.auth.resetPasswordForEmail("staff@example.com")).error, null);
  assert.ok([...jar.keys()].some((name) => name.includes("code-verifier")));
  const callbackClient = makeClient();
  const events = [];
  const { data: { subscription } } = callbackClient.auth.onAuthStateChange((event) => { events.push(event); });
  assert.equal((await callbackClient.auth.exchangeCodeForSession("test-code")).error, null);
  subscription.unsubscribe();
  assert.ok(events.includes("PASSWORD_RECOVERY"));
  assert.ok([...jar].some(([name, value]) => name.endsWith("auth-token") && value));
  assert.equal(requests.length, 2);
});
