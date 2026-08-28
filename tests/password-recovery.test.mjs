import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PASSWORD_RECOVERY_MESSAGE,
  passwordRecoveryRedirect,
  requestPasswordRecovery,
  updateRecoveredPassword,
} from "../src/lib/auth/password-recovery.ts";

test("login exposes Forgot Password and recovery uses a fixed safe callback", async () => {
  const login = await readFile(new URL("../src/app/login/login-form.tsx", import.meta.url), "utf8");
  assert.match(login, /href="\/forgot-password"/);
  assert.equal(passwordRecoveryRedirect("https://app.example.com"), "https://app.example.com/auth/callback?next=%2Fupdate-password");
  assert.equal(passwordRecoveryRedirect("http://localhost:3000"), "http://localhost:3000/auth/callback?next=%2Fupdate-password");
  assert.throws(() => passwordRecoveryRedirect("http://app.example.com"), /HTTPS/);
});

test("recovery requests call Supabase without enumerating account or provider errors", async () => {
  const calls = [];
  const success = { auth: { resetPasswordForEmail: async (...args) => { calls.push(args); return { error: null }; } } };
  const failure = { auth: { resetPasswordForEmail: async () => ({ error: new Error("unknown user") }) } };
  assert.equal(await requestPasswordRecovery(success, " person@example.com ", "https://app.example.com"), PASSWORD_RECOVERY_MESSAGE);
  assert.equal(await requestPasswordRecovery(failure, "missing@example.com", "https://app.example.com"), PASSWORD_RECOVERY_MESSAGE);
  assert.deepEqual(calls, [["person@example.com", { redirectTo: "https://app.example.com/auth/callback?next=%2Fupdate-password" }]]);
});

test("password update requires recovery context, matching strong input, and an authenticated recovery user", async () => {
  let updates = 0;
  const client = { auth: {
    getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    updateUser: async ({ password }) => { updates += 1; assert.equal(password, "long-secure-password"); return { error: null }; },
  } };
  assert.equal((await updateRecoveredPassword(client, { password: "long-secure-password", confirmation: "long-secure-password", hasRecoveryContext: false })).status, "error");
  assert.match((await updateRecoveredPassword(client, { password: "long-secure-password", confirmation: "different-password", hasRecoveryContext: true })).message, /does not match/);
  assert.match((await updateRecoveredPassword(client, { password: "short", confirmation: "short", hasRecoveryContext: true })).message, /at least 12/);
  assert.equal((await updateRecoveredPassword(client, { password: "long-secure-password", confirmation: "long-secure-password", hasRecoveryContext: true })).status, "success");
  assert.equal(updates, 1);
});

test("expired Supabase session fails closed and no application password persistence exists", async () => {
  const client = { auth: {
    getUser: async () => ({ data: { user: null }, error: new Error("expired") }),
    updateUser: async () => { throw new Error("must not update"); },
  } };
  assert.match((await updateRecoveredPassword(client, { password: "long-secure-password", confirmation: "long-secure-password", hasRecoveryContext: true })).message, /invalid or has expired/);
  const [action, schema] = await Promise.all([
    readFile(new URL("../src/app/update-password/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
  ]);
  assert.match(action, /supabase\.auth\.signOut\(\)/);
  assert.doesNotMatch(action, /prisma|console\.|logger/);
  assert.doesNotMatch(schema, /passwordHash|encryptedPassword|password\s+String/i);
});
