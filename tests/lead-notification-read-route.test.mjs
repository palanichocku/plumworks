import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const id = "20000000-0000-0000-0000-000000000001";
async function harness(read) {
  const logs = [], paths = [];
  const source = await readFile(new URL("../src/app/api/lead-notifications/[id]/read/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  const dependencies = { "next/cache": { revalidatePath: (path) => paths.push(path) }, "@/lib/marketing-lead-notification-center": { readLeadNotification: read } };
  new Function("require", "module", "exports", "console", code)((name) => { assert.ok(dependencies[name]); return dependencies[name]; }, loaded, loaded.exports, { info: (record) => logs.push(record), error: (record) => logs.push(record) });
  return { ...loaded.exports, logs, paths };
}
const request = (headers = {}) => new Request(`https://example.test/api/lead-notifications/${id}/read`, { method: "POST", headers: { origin: "https://example.test", ...headers }, body: JSON.stringify({ shopId: "ignored-shop", userId: "ignored-user" }) });

test("POST delegates only notification ID to authoritative authorization and returns 204", async () => {
  const calls = [];
  const h = await harness(async (...args) => { calls.push(args); return { href: "/leads/example" }; });
  assert.equal((await h.POST(request(), { params: Promise.resolve({ id }) })).status, 204);
  assert.deepEqual(calls, [[id]]);
  assert.deepEqual(h.paths, ["/leads", "/leads/example"]);
  assert.deepEqual(h.logs, [{ event: "lead_notification_read", notificationId: id, result: "persisted" }]);
});
for (const [message, status] of [["Sign in with an active shop membership.", 401], ["Notification not found.", 404], ["private database details secret@example.test", 500]]) {
  test(`POST safely maps authoritative failure to ${status}`, async () => {
    const h = await harness(async () => { throw new Error(message); });
    const response = await h.POST(request(), { params: Promise.resolve({ id }) });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Could not mark notification read." });
    assert.deepEqual(h.paths, []);
    assert.deepEqual(h.logs, [{ event: "lead_notification_read", notificationId: id, result: "failed" }]);
  });
}
test("cross-origin POST is rejected before mutation", async () => {
  const h = await harness(async () => { throw new Error("must not be called"); });
  assert.equal((await h.POST(request({ origin: "https://attacker.test" }), { params: Promise.resolve({ id }) })).status, 403);
});
test("invalid IDs never leak attacker-supplied PII into logs", async () => {
  const h = await harness(async () => { throw new Error("Notification not found."); });
  assert.equal((await h.POST(request(), { params: Promise.resolve({ id: "private@example.test" }) })).status, 404);
  assert.ok(!JSON.stringify(h.logs).includes("private"));
});

test("same-origin browser Host is accepted when Next uses an internal URL hostname", async () => {
  const h = await harness(async () => ({ href: "/leads/example" }));
  const input = new Request(`http://localhost:3107/api/lead-notifications/${id}/read`, { method: "POST", headers: { host: "127.0.0.1:3107", origin: "http://127.0.0.1:3107", "sec-fetch-site": "same-origin" } });
  assert.equal((await h.POST(input, { params: Promise.resolve({ id }) })).status, 204);
});
