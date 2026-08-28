import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertMemberRemovalAllowed, assertOwnerRoleAssignmentAllowed, assertRoleChangeAllowed } from "../src/lib/staff-governance.ts";

const roleChange = (overrides = {}) => ({ actingRole: "OWNER", targetRole: "STAFF", requestedRole: "OWNER", ownerCount: 1, ...overrides });
const removal = (overrides = {}) => ({ actingRole: "OWNER", targetRole: "OWNER", ownerCount: 2, ...overrides });

test("OWNER may promote STAFF or ADMIN to OWNER", () => {
  assert.doesNotThrow(() => assertRoleChangeAllowed(roleChange({ targetRole: "STAFF" })));
  assert.doesNotThrow(() => assertRoleChangeAllowed(roleChange({ targetRole: "ADMIN" })));
});

test("ADMIN cannot promote self or another membership to OWNER", () => {
  assert.throws(() => assertRoleChangeAllowed(roleChange({ actingRole: "ADMIN", targetRole: "ADMIN" })), /Only an owner/);
  assert.throws(() => assertRoleChangeAllowed(roleChange({ actingRole: "ADMIN", targetRole: "STAFF" })), /Only an owner/);
});

test("ADMIN cannot create an OWNER invitation", () => {
  assert.throws(() => assertOwnerRoleAssignmentAllowed("ADMIN", "OWNER"), /Only an owner/);
  assert.doesNotThrow(() => assertOwnerRoleAssignmentAllowed("ADMIN", "ADMIN"));
  assert.doesNotThrow(() => assertOwnerRoleAssignmentAllowed("OWNER", "OWNER"));
});

test("ADMIN cannot demote or remove an OWNER", () => {
  assert.throws(() => assertRoleChangeAllowed(roleChange({ actingRole: "ADMIN", targetRole: "OWNER", requestedRole: "ADMIN", ownerCount: 2 })), /Only an owner/);
  assert.throws(() => assertMemberRemovalAllowed(removal({ actingRole: "ADMIN" })), /Only an owner/);
});

test("OWNER may demote or remove another OWNER when another owner remains", () => {
  assert.doesNotThrow(() => assertRoleChangeAllowed(roleChange({ targetRole: "OWNER", requestedRole: "ADMIN", ownerCount: 2 })));
  assert.doesNotThrow(() => assertMemberRemovalAllowed(removal({ ownerCount: 2 })));
});

test("final OWNER cannot be demoted or removed", () => {
  assert.throws(() => assertRoleChangeAllowed(roleChange({ targetRole: "OWNER", requestedRole: "STAFF", ownerCount: 1 })), /last owner/);
  assert.throws(() => assertMemberRemovalAllowed(removal({ ownerCount: 1 })), /last owner/);
});

test("server actions use authenticated acting role and current-Shop target lookup", async () => {
  const source = await readFile(new URL("../src/app/(app)/admin/staff/actions.ts", import.meta.url), "utf8");
  assert.match(source, /requirePermission\("manage_staff"\)/);
  assert.match(source, /where: \{ id: membershipId, shopId: membership\.shopId \}/);
  assert.match(source, /actingRole: membership\.role/);
  assert.match(source, /assertOwnerRoleAssignmentAllowed\(membership\.role, role\)/);
  assert.doesNotMatch(source, /formData\.get\(["'](?:shopId|actingRole)["']\)/);
});
