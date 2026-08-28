import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployment runbook locks production Auth recovery and identity controls", async () => {
  const runbook = await readFile(new URL("../docs/client-deployment-runbook.md", import.meta.url), "utf8");
  for (const requirement of ["Disable public self-signup", "Confirm Email", "custom SMTP", "/auth/callback", "security notifications", "recovery rehearsal"]) {
    assert.match(runbook, new RegExp(requirement.replace("/", "\\/"), "i"));
  }
  assert.match(runbook, /ShopMembership.*required/);
  assert.match(runbook, /Do not use wildcard production redirects/);
});
