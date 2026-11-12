import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/twilio/debugger/route.ts", import.meta.url), "utf8");

test("Twilio Debugger webhook bypasses shop session middleware, not signature verification", () => {
  assert.match(proxy, /isHealthPath\(pathname\) \|\| isSignedTwilioWebhookPath\(pathname\)/);
  assert.match(proxy, /"\/api\/twilio\/debugger"/);
  assert.match(route, /verifyTwilioFormWebhook\(/);
  assert.match(route, /params\.get\("AccountSid"\) !== process\.env\.TWILIO_ACCOUNT_SID/);
  assert.match(route, /debuggerSidPattern\.test\(eventSid\)/);
});

test("the Debugger handler excludes raw Payload, webhook bodies, and headers from logs", () => {
  assert.match(route, /const summary = \{ source: "twilio-debugger", eventSid, level, errorCode, resourceSid, serviceSid \}/);
  assert.match(route, /console\.error\(JSON\.stringify\(summary\)\)/);
  assert.match(route, /console\.warn\(JSON\.stringify\(summary\)\)/);
  assert.doesNotMatch(route, /console\.(?:log|warn|error)\((?:payload|params|request)\)/);
});
