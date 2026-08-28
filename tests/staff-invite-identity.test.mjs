import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { confirmedInviteEmail } from "../src/lib/staff-invite-identity.ts";

test("confirmed matching identity supplies a normalized invite email", () => {
  assert.equal(confirmedInviteEmail({ email: " Staff@Example.COM ", email_confirmed_at: "2026-08-28T12:00:00Z" }), "staff@example.com");
});

test("unconfirmed identity cannot accept a staff invitation", () => {
  assert.throws(() => confirmedInviteEmail({ email: "staff@example.com", email_confirmed_at: null }), /Confirm your email/);
});

test("invite acceptance retains exact email matching and authenticated UUID membership", async () => {
  const source = await readFile(new URL("../src/app/invite/actions.ts", import.meta.url), "utf8");
  assert.match(source, /confirmedInviteEmail\(user\)/);
  assert.match(source, /email: \{ equals: email, mode: "insensitive" \}/);
  assert.match(source, /userId: user\.id/);
  assert.doesNotMatch(source, /formData\.get\(["'](?:email|shopId|userId)["']\)/);
});
