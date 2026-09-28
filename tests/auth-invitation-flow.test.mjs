import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertOwnerRoleAssignmentAllowed } from "../src/lib/staff-governance.ts";
import { getAuthCallbackFlow, sendStaffAuthInvitation, staffInvitationRedirect } from "../src/lib/auth/staff-invitation.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("OWNER and ADMIN can invite permitted roles; only OWNER can grant OWNER", () => {
  assert.doesNotThrow(() => assertOwnerRoleAssignmentAllowed("OWNER", "OWNER"));
  assert.doesNotThrow(() => assertOwnerRoleAssignmentAllowed("ADMIN", "STAFF"));
  assert.doesNotThrow(() => assertOwnerRoleAssignmentAllowed("ADMIN", "ADMIN"));
  assert.throws(() => assertOwnerRoleAssignmentAllowed("ADMIN", "OWNER"), /Only an owner/);
});

test("staff invitation action requires staff permission and derives shop/actor from membership", async () => {
  const source = await read("../src/app/(app)/admin/staff/actions.ts");
  assert.match(source, /requirePermission\("manage_staff"\)/);
  assert.match(source, /assertOwnerRoleAssignmentAllowed\(membership\.role, role\)/);
  assert.match(source, /shopId: membership\.shopId/);
  assert.match(source, /invitedByUserId: user\?\.id/);
  assert.match(source, /staff_invite_created/);
  assert.match(source, /staff_invite_delivery_failed/);
  assert.match(source, /sendStaffAuthInvitation\(createAdminClient\(\), email, siteUrl\)/);
  assert.doesNotMatch(source, /formData\.get\(["'](?:shopId|actingRole|userId)["']\)/);
});

test("Supabase Auth invite request uses the fixed callback and confirms successful request", async () => {
  const calls = [];
  const client = { auth: { admin: { inviteUserByEmail: async (...args) => { calls.push(args); return { error: null }; } } } };
  assert.deepEqual(await sendStaffAuthInvitation(client, "staff@example.com", "https://shop.example.com"), { status: "sent" });
  assert.equal(calls[0][0], "staff@example.com");
  assert.equal(calls[0][1].redirectTo, "https://shop.example.com/auth/callback?flow=invite&next=%2Finvite");
  assert.throws(() => staffInvitationRedirect("http://shop.example.com"), /HTTPS/);
});

test("Auth invitation delivery failures never report success", async () => {
  const returnedError = { auth: { admin: { inviteUserByEmail: async () => ({ error: new Error("private provider detail") }) } } };
  const rejected = { auth: { admin: { inviteUserByEmail: async () => { throw new Error("private provider detail"); } } } };
  assert.deepEqual(await sendStaffAuthInvitation(returnedError, "staff@example.com", "https://shop.example.com"), { status: "failed" });
  assert.deepEqual(await sendStaffAuthInvitation(rejected, "staff@example.com", "https://shop.example.com"), { status: "failed" });
});

test("unconfirmed identity retry uses the same invite endpoint after a partial delivery failure", async () => {
  let attempts = 0;
  const client = { auth: { admin: { inviteUserByEmail: async (email) => {
    assert.equal(email, "staff@example.com");
    attempts += 1;
    // Models Auth's documented reuse of the unconfirmed identity on retry.
    return { error: attempts === 1 ? { code: "unexpected_failure" } : null };
  } } } };
  assert.deepEqual(await sendStaffAuthInvitation(client, "staff@example.com", "https://shop.example.com"), { status: "failed" });
  assert.deepEqual(await sendStaffAuthInvitation(client, "staff@example.com", "https://shop.example.com"), { status: "sent" });
  assert.equal(attempts, 2);
});

test("only the structured email_exists error selects existing-account onboarding", async () => {
  for (const error of [{ code: "email_exists" }, { message: "email_exists" }, { code: "over_email_send_rate_limit" }]) {
    const client = { auth: { admin: { inviteUserByEmail: async () => ({ error }) } } };
    assert.deepEqual(await sendStaffAuthInvitation(client, "staff@example.com", "https://shop.example.com"), { status: error.code === "email_exists" ? "existing_account" : "failed" });
  }
});

test("callback accepts invite and recovery only at their fixed internal destinations", () => {
  const params = (values) => new URLSearchParams(values);
  assert.equal(getAuthCallbackFlow(params({ code: "opaque", flow: "invite", next: "/invite" })), null);
  assert.equal(getAuthCallbackFlow(params({ token_hash: "opaque", type: "invite", flow: "invite", next: "/invite" })), "invite");
  assert.equal(getAuthCallbackFlow(params({ code: "opaque", next: "/update-password" })), "recovery");
  assert.equal(getAuthCallbackFlow(params({ code: "opaque", flow: "recovery", next: "/update-password" })), "recovery");
  assert.equal(getAuthCallbackFlow(params({ code: "opaque", flow: "invite", next: "https://evil.example" })), null);
  assert.equal(getAuthCallbackFlow(params({ token_hash: "opaque", type: "recovery", flow: "invite", next: "/invite" })), null);
  assert.equal(getAuthCallbackFlow(params({ code: "opaque", flow: "invite", next: "/dashboard" })), null);
  assert.equal(getAuthCallbackFlow(params({ flow: "invite", next: "/invite" })), null);
});

test("callback exchanges and validates a session before routing either flow", async () => {
  const source = await read("../src/app/auth/callback/route.ts");
  assert.match(source, /getAuthCallbackFlow\(request\.nextUrl\.searchParams\)/);
  assert.match(source, /exchangeCodeForSession\(code\)/);
  assert.match(source, /verifyOtp\(\{ token_hash: tokenHash, type: "invite" \}\)/);
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /new URL\("\/invite", request\.url\)/);
  assert.match(source, /new URL\("\/update-password", request\.url\)/);
  assert.match(source, /RECOVERY_CONTEXT_COOKIE/);
  assert.match(source, /Cache-Control", "private, no-store"/);
  assert.match(source, /Referrer-Policy", "no-referrer"/);
});

test("invite acceptance rechecks email, confirmation, pending status, membership, shop association and audit", async () => {
  const source = await read("../src/app/invite/actions.ts");
  assert.match(source, /confirmedInviteEmail\(user\)/);
  assert.match(source, /id: inviteId, status: "pending", email: \{ equals: email, mode: "insensitive" \}/);
  assert.match(source, /where: \{ userId: user\.id \}/);
  assert.match(source, /if \(existing\) throw new Error/);
  assert.match(source, /shopId: invite\.shopId, userId: user\.id/);
  assert.match(source, /staffInvite\.update\(\{ where: \{ id: invite\.id \}, data: \{ status: "accepted" \} \}\)/);
  assert.match(source, /staff_invite_accepted/);
  assert.match(source, /isolationLevel: "Serializable"/);
  assert.match(source, /SELECT id FROM staff_invites[\s\S]*FOR UPDATE/);
});

test("invite UI sets password directly with Supabase Auth before acceptance; no password reaches server action", async () => {
  const form = await read("../src/app/invite/invitation-password-form.tsx");
  const page = await read("../src/app/invite/page.tsx");
  assert.match(form, /createClient\(\)\.auth\.updateUser\(\{ password \}\)/);
  assert.match(form, /action=\{acceptStaffInvite\}/);
  assert.match(form, /passwordSet/);
  assert.match(page, /status: "pending"/);
  assert.match(page, /InvitationPasswordForm inviteId=\{invite\.id\}/);
  assert.doesNotMatch(form, /console\.(?:log|error)\([^\n]*password/);
});

test("authenticated users without an active membership are routed to invite onboarding", async () => {
  const layout = await read("../src/app/(app)/layout.tsx");
  assert.match(layout, /if \(!user\)[\s\S]*redirect\("\/login"\)/);
  assert.match(layout, /if \(!membership\)[\s\S]*redirect\("\/invite"\)/);
});

test("Auth Admin secret is isolated to a server-only module", async () => {
  const admin = await read("../src/lib/supabase/admin.ts");
  const browser = await read("../src/lib/supabase/client.ts");
  const files = ["../src/app/login/login-form.tsx", "../src/app/invite/invitation-password-form.tsx", "../src/app/(app)/admin/staff/invite-form.tsx"];
  assert.match(admin, /^import "server-only";/);
  assert.match(admin, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(admin, /NEXT_PUBLIC_SUPABASE_SERVICE/);
  assert.doesNotMatch(browser, /SUPABASE_SERVICE_ROLE_KEY|supabase\/admin/);
  for (const path of files) assert.doesNotMatch(await read(path), /SUPABASE_SERVICE_ROLE_KEY|supabase\/admin/);
});

test("built browser chunks do not contain the Auth Admin secret name or module", async (context) => {
  const chunkRoot = fileURLToPath(new URL("../.next/static/chunks/", import.meta.url));
  try {
    await access(chunkRoot);
  } catch {
    context.skip("Run after next build to inspect generated browser chunks.");
    return;
  }
  async function collect(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collect(path);
      if (!entry.isFile() || !entry.name.endsWith(".js")) return [];
      return [await readFile(path, "utf8")];
    }));
    return nested.flat();
  }
  const chunks = await collect(chunkRoot);
  assert.ok(chunks.length > 0, "expected generated browser chunks");
  for (const chunk of chunks) {
    // Report only a boolean failure, never the contents of a potentially leaked key.
    assert.equal(/SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey|supabase\/admin|sb_secret_[A-Za-z0-9_-]+/.test(chunk), false, "privileged Admin configuration found in a browser chunk");
    const jwtCandidates = chunk.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g);
    for (const [, payload] of jwtCandidates) {
      let role;
      try { role = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role; } catch { continue; }
      assert.notEqual(role, "service_role", "privileged JWT found in a browser chunk");
    }
  }
});
