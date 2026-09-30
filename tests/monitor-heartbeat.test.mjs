import test from "node:test";
import assert from "node:assert/strict";
import { deliverMonitoringHeartbeat, shouldSendHeartbeat } from "../scripts/monitor-heartbeat.ts";

const heartbeatUrl = "https://example.invalid/heartbeat/private-token";

test("heartbeat policy allows healthy and warning runs only when reporting succeeded and URL is configured", () => {
  assert.equal(shouldSendHeartbeat("HEALTHY", undefined, heartbeatUrl), true);
  assert.equal(shouldSendHeartbeat("WARNING", undefined, heartbeatUrl), true);
  assert.equal(shouldSendHeartbeat("FAILED", undefined, heartbeatUrl), false);
  assert.equal(shouldSendHeartbeat("HEALTHY", 1, heartbeatUrl), false);
  assert.equal(shouldSendHeartbeat("WARNING", 1, heartbeatUrl), false);
  assert.equal(shouldSendHeartbeat("HEALTHY", undefined, undefined), false);
  assert.equal(shouldSendHeartbeat("WARNING", undefined, ""), false);
});

test("successful heartbeat logs only the fixed delivery message", async () => {
  const messages = [];
  const logger = { log: (message) => messages.push(message), warn: (message) => messages.push(message) };
  await deliverMonitoringHeartbeat(heartbeatUrl, async (url, options) => {
    assert.equal(url, heartbeatUrl);
    assert.equal(options.method, "GET");
    return { ok: true };
  }, logger);
  assert.deepEqual(messages, ["Monitoring heartbeat delivered."]);
  assert.doesNotMatch(messages.join(" "), /private-token|example\.invalid/);
});

test("rejected and thrown heartbeat deliveries retain a sanitized warning", async () => {
  const messages = [];
  const logger = { log: (message) => messages.push(message), warn: (message) => messages.push(message) };
  await deliverMonitoringHeartbeat(heartbeatUrl, async () => ({ ok: false }), logger);
  await deliverMonitoringHeartbeat(heartbeatUrl, async () => { throw new Error(`raw response from ${heartbeatUrl}`); }, logger);
  assert.deepEqual(messages, ["Monitoring heartbeat delivery failed.", "Monitoring heartbeat delivery failed."]);
  assert.doesNotMatch(messages.join(" "), /private-token|example\.invalid|raw response/);
});
