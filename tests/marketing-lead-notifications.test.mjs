import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}, environment = {}, logger = { error() {}, info() {} }) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "console", outputText)((id) => {
    if (id === "server-only") return {};
    if (id === "@/lib/marketing-lead-contact") return contactMethods;
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports, { env: environment }, logger);
  return loaded.exports;
}
const contactMethods = await load("src/lib/marketing-lead-contact.ts");
const settings = await load("src/lib/marketing-lead-notification-settings.ts");
const defaults = { marketingLeadEmailNotificationsEnabled: true, marketingLeadNotifyEmail1: null, marketingLeadNotifyEmail2: null };
for (const [name, overrides, expected] of [
  ["Email 1 only", { marketingLeadNotifyEmail1: " First@Example.test " }, ["first@example.test"]],
  ["Email 1 and Email 2", { marketingLeadNotifyEmail1: "first@example.test", marketingLeadNotifyEmail2: "second@example.test" }, ["first@example.test", "second@example.test"]],
  ["duplicate emails", { marketingLeadNotifyEmail1: " FIRST@example.test ", marketingLeadNotifyEmail2: "first@example.test" }, ["first@example.test"]],
  ["email disabled", { marketingLeadEmailNotificationsEnabled: false, marketingLeadNotifyEmail1: "first@example.test" }, []],
  ["environment fallback", {}, ["fallback@example.test"]],
  ["Email 2 alone", { marketingLeadNotifyEmail2: "second@example.test" }, ["second@example.test"]],
]) {
  test(name, () => assert.deepEqual(settings.leadNotificationRecipients({ ...defaults, ...overrides }, " Fallback@Example.test "), expected));
}
test("notification email validation normalizes and rejects invalid addresses", () => {
  assert.equal(settings.normalizeLeadNotificationEmail(" First@EXAMPLE.test "), "first@example.test");
  assert.equal(settings.normalizeLeadNotificationEmail("  "), null);
  for (const invalid of ["bad", "a@b", "a\nb@example.test", "a@example.test,b@example.test", `${"a".repeat(255)}@example.test`]) {
    // Multiple addresses are not a valid single email field.
    assert.throws(() => settings.normalizeLeadNotificationEmail(invalid));
  }
});
const lead = { id: "10000000-0000-0000-0000-000000000001", shopId: "shop-a", source: "CONTACT", name: "Example Visitor", phone: "555-0100", email: "visitor@example.test", vehicleYear: 2021, vehicleMake: "Example", vehicleModel: "Sedan", requestedService: "Brakes", preferredDate: new Date("2026-10-01"), preferredTime: "10:00", preferredContactMethod: "TEXT", message: "Please call me", status: "NEW" };

for (const source of ["CONTACT", "APPOINTMENT", "DROP_OFF"]) {
  test(`${source} email includes complete content without internal identifiers`, async () => {
    const sent = [];
    const notifier = await load("src/lib/marketing-lead-notifications.ts", {
      "@/lib/prisma": { prisma: { shop: { findUniqueOrThrow: async ({ where }) => { assert.equal(where.id, lead.shopId); return { ...defaults, marketingLeadNotifyEmail1: "one@example.test", marketingLeadNotifyEmail2: "two@example.test", marketingLeadInAppNotificationsEnabled: false }; } } } },
      "@/lib/marketing-lead-notification-settings": settings,
      "@/lib/email/resend": { sendResendEmail: async (message) => { sent.push(message); return { ok: true, id: "email" }; } },
    }, { NEXT_PUBLIC_SITE_URL: "https://www.subbuscardoc.com" });
    await notifier.notifyNewMarketingLead({ ...lead, source });
    assert.equal(sent.length, 2);
    const label = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" }[source];
    assert.equal(sent[0].subject, `New ${label} Request — Example Visitor`);
    for (const value of [lead.name, lead.phone, lead.email, "2021 Example Sedan", lead.requestedService, "2026-10-01", "10:00", lead.message, `Submission source: ${label}`, "Preferred contact method: Text", "https://www.subbuscardoc.com/leads"]) assert.ok(sent[0].text.includes(value));
    assert.ok(!sent[0].text.includes(lead.id));
    assert.ok(!sent[0].text.includes(lead.shopId));
  });
}

test("Resend errors and thrown deliveries do not prevent the second recipient attempt", async () => {
  for (const throws of [true, false]) {
    let calls = 0;
    const notifier = await load("src/lib/marketing-lead-notifications.ts", {
      "@/lib/prisma": { prisma: { shop: { findUniqueOrThrow: async () => ({ ...defaults, marketingLeadNotifyEmail1: "one@example.test", marketingLeadNotifyEmail2: "two@example.test" }) } } },
      "@/lib/marketing-lead-notification-settings": settings,
      "@/lib/email/resend": { sendResendEmail: async () => { calls++; if (throws) throw new Error("network"); return { ok: false, code: "request_rejected" }; } },
    });
    await notifier.notifyNewMarketingLead(lead);
    assert.equal(calls, 2);
  }
});

async function submissionHarness({ enabled = true, emailFails = false, notificationFails = false } = {}) {
  const stored = { leads: [], notifications: [] };
  let emailCalls = 0;
  const prisma = { $transaction: async (callback) => {
    const staged = structuredClone(stored);
    const result = await callback({
      shop: { findUniqueOrThrow: async ({ where }) => { assert.equal(where.id, lead.shopId); return { marketingLeadInAppNotificationsEnabled: enabled }; } },
      marketingLead: { create: async ({ data }) => { const created = { ...lead, ...data }; staged.leads.push(created); return created; } },
      marketingLeadNotification: { create: async ({ data }) => { if (notificationFails) throw new Error("write failed"); staged.notifications.push(data); } },
    });
    Object.assign(stored, staged);
    return result;
  } };
  const submission = await load("src/lib/marketing-lead-submission.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/marketing-lead-notifications": { notifyNewMarketingLead: async () => { emailCalls++; assert.equal(stored.leads.length, 1, "email runs after commit"); if (emailFails) throw new Error("Email unavailable"); } },
  });
  return { ...submission, stored, emailCalls: () => emailCalls };
}
for (const enabled of [true, false]) {
  test(`in-app ${enabled ? "enabled creates" : "disabled skips"} notification independently of email`, async () => {
    const harness = await submissionHarness({ enabled });
    await harness.storeMarketingLead(lead);
    assert.equal(harness.stored.leads.length, 1);
    assert.equal(harness.stored.notifications.length, enabled ? 1 : 0);
    if (enabled) assert.deepEqual(harness.stored.notifications[0], { shopId: lead.shopId, marketingLeadId: lead.id });
    assert.equal(harness.emailCalls(), 1);
  });
}
test("email failure preserves committed lead and notification", async () => {
  const harness = await submissionHarness({ emailFails: true });
  assert.equal((await harness.storeMarketingLead(lead)).id, lead.id);
  assert.equal(harness.stored.leads.length, 1);
  assert.equal(harness.stored.notifications.length, 1);
});
test("notification write failure rolls back the lead transaction and sends no email", async () => {
  const harness = await submissionHarness({ notificationFails: true });
  await assert.rejects(harness.storeMarketingLead(lead));
  assert.deepEqual(harness.stored, { leads: [], notifications: [] });
  assert.equal(harness.emailCalls(), 0);
});

async function centerHarness() {
  let access = { user: { id: "user-a" }, membership: { shopId: "shop-a", role: "STAFF" } };
  const rows = [
    { id: "20000000-0000-0000-0000-000000000001", shopId: "shop-a", marketingLeadId: lead.id, createdAt: new Date("2026-09-20"), marketingLead: lead },
    { id: "20000000-0000-0000-0000-000000000002", shopId: "shop-b", marketingLeadId: "10000000-0000-0000-0000-000000000002", createdAt: new Date("2026-09-20"), marketingLead: { ...lead, shopId: "shop-b" } },
  ];
  const reads = [];
  const filtered = (where) => {
    assert.ok(where.shopId, "every notification query must be tenant scoped");
    return rows.filter((row) => row.shopId === where.shopId && (!where.id || row.id === where.id) && (!where.createdAt || row.createdAt <= where.createdAt.lte) && (!where.reads || !reads.some((read) => read.notificationId === row.id && read.shopId === where.reads.none.shopId && read.userId === where.reads.none.userId)));
  };
  const prisma = {
    shop: { findUniqueOrThrow: async () => ({ marketingLeadInAppNotificationsEnabled: true }) },
    marketingLeadNotification: {
      findFirst: async ({ where }) => filtered(where)[0] ?? null,
      findMany: async ({ where, select, take }) => filtered(where).slice(0, take).map((row) => ({ ...row, reads: reads.filter((read) => read.notificationId === row.id && read.userId === select?.reads?.where.userId && read.shopId === select?.reads?.where.shopId) })),
      count: async ({ where }) => filtered(where).length,
    },
    marketingLeadNotificationRead: { createMany: async ({ data, skipDuplicates }) => {
      assert.equal(skipDuplicates, true);
      for (const read of data) if (!reads.some((existing) => existing.notificationId === read.notificationId && existing.userId === read.userId)) reads.push(read);
    } },
    marketingLead: { findFirst: async ({ where }) => { assert.ok(where.shopId); return rows.find((row) => row.shopId === where.shopId && row.marketingLeadId === where.id)?.marketingLead ?? null; } },
  };
  prisma.$transaction = async (work) => typeof work === "function" ? work(prisma) : Promise.all(work);
  const center = await load("src/lib/marketing-lead-notification-center.ts", {
    "@/lib/permissions": { hasPermission: (role, permission) => ["OWNER", "ADMIN", "STAFF"].includes(role) && permission === "view_marketing_leads" },
    "@/lib/prisma": { prisma }, "@/lib/data/membership": { getCurrentMembership: async () => access },
  });
  return { ...center, rows, reads, setAccess: (next) => { access = next; } };
}
test("read state belongs to each user, remains idempotent, and never changes lead status", async () => {
  const center = await centerHarness();
  const before = structuredClone(center.rows);
  assert.equal((await center.getLeadNotificationState()).unreadCount, 1);
  assert.deepEqual(await center.readLeadNotification(center.rows[0].id), { href: `/leads/${lead.id}` });
  await center.readLeadNotification(center.rows[0].id);
  assert.equal(center.reads.length, 1);
  assert.equal((await center.getLeadNotificationState()).unreadCount, 0);
  center.setAccess({ user: { id: "user-b" }, membership: { shopId: "shop-a", role: "STAFF" } });
  assert.equal((await center.getLeadNotificationState()).unreadCount, 1);
  await center.readAllLeadNotifications(new Date().toISOString());
  assert.equal((await center.getLeadNotificationState()).unreadCount, 0);
  assert.equal(center.reads.length, 2);
  assert.deepEqual(center.rows, before);
});
test("foreign-shop notifications and guessed lead IDs are inaccessible", async () => {
  const center = await centerHarness();
  await assert.rejects(center.readLeadNotification(center.rows[1].id), /not found/);
  assert.equal(center.reads.length, 0);
  assert.equal((await center.getOperationalLead(center.rows[1].marketingLeadId)).lead, null);
  assert.equal((await center.getLeadNotificationState()).items.length, 1);
  assert.equal((await center.getOperationalLead("10000000-0000-0000-0000-000000000099")).lead, null);
  await center.readAllLeadNotifications(new Date().toISOString());
  assert.ok(center.reads.every((read) => read.shopId === "shop-a"));
});
test("anonymous and removed memberships cannot query or mutate alerts or access leads", async () => {
  const center = await centerHarness();
  for (const access of [{ user: null, membership: null }, { user: { id: "removed" }, membership: null }]) {
    center.setAccess(access);
    await assert.rejects(center.getLeadNotificationState(), /membership/);
    await assert.rejects(center.readLeadNotification(center.rows[0].id), /membership/);
    await assert.rejects(center.readAllLeadNotifications(new Date().toISOString()), /membership/);
    await assert.rejects(center.getOperationalLead(lead.id), /membership/);
  }
});

test("Contact, Appointment, and Drop-Off forms keep validation, attribution and success redirects even on email failure", async () => {
  const attribution = await load("src/lib/marketing-attribution.ts");
  for (const [action, source, path] of [["submitContactLead", "CONTACT", "/contact"], ["submitAppointmentLead", "APPOINTMENT", "/appointment"], ["submitDropOffLead", "DROP_OFF", "/drop-off"]]) {
    const submission = await submissionHarness({ emailFails: true });
    const actions = await load("src/app/(marketing)/lead-actions.ts", {
      "next/navigation": { redirect: (url) => { throw new Error(`redirect:${url}`); } },
      "next/headers": { cookies: async () => ({ get: () => undefined }) },
      "@/lib/prisma": { prisma: { shop: { findMany: async () => [{ id: lead.shopId }] } } },
      "@/lib/marketing-lead-submission": submission,
      "@/lib/marketing-attribution": attribution,
    });
    const invalid = new FormData();
    await assert.rejects(actions[action](invalid), { message: `redirect:${path}?error=1` });
    assert.equal(submission.stored.leads.length, 0);
    const spam = new FormData(); spam.set("website", "bot");
    await assert.rejects(actions[action](spam), { message: `redirect:${path}?sent=1` });
    assert.equal(submission.stored.leads.length, 0);
    const form = new FormData();
    for (const [key, value] of Object.entries({ name: " Example Visitor ", phone: "555-0100", email: "Visitor@Example.test", vehicleYear: "2021", vehicleMake: "Example", vehicleModel: "Sedan", requestedService: "Brakes", message: "Please call me", preferredDate: "2026-10-01", preferredTime: "10:00", preferredContactMethod: "TEXT" })) form.set(key, value);
    await assert.rejects(actions[action](form), { message: `redirect:${path}?sent=1` });
    assert.equal(submission.stored.leads.length, 1);
    assert.equal(submission.stored.leads[0].source, source);
    assert.equal(submission.stored.leads[0].email, "visitor@example.test");
    assert.equal(submission.stored.leads[0].submissionPath, path);
    assert.equal(submission.stored.leads[0].status, "NEW");
  }
});

test("migration protects notification tables and contains no historical backfill", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260921120000_add_marketing_lead_notifications/migration.sql", import.meta.url), "utf8");
  for (const table of ["marketing_lead_notifications", "marketing_lead_notification_reads"]) assert.ok(sql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));
  assert.match(sql, /FROM anon, authenticated/);
  assert.match(sql, /FOREIGN KEY \("shop_id", "notification_id"\)/);
  assert.match(sql, /FOREIGN KEY \("shop_id", "user_id"\)/);
  assert.doesNotMatch(sql, /INSERT INTO/i);
});

test("reading notifications preserves every existing MarketingLead status", async () => {
  for (const status of ["NEW", "CONTACTED", "SCHEDULED", "CONVERTED", "CLOSED"]) {
    const center = await centerHarness();
    center.rows[0].marketingLead = { ...lead, status };
    await center.readLeadNotification(center.rows[0].id);
    await center.readAllLeadNotifications(new Date().toISOString());
    assert.equal(center.rows[0].marketingLead.status, status);
  }
});

test("settings action enforces the existing permission and saves normalized settings only for the membership shop", async () => {
  let allowed = false;
  const writes = [];
  const actions = await load("src/app/(app)/admin/shop-settings/actions.ts", {
    "next/cache": { revalidatePath() {} }, "next/navigation": {}, "@/generated/prisma/client": {},
    "@/lib/audit": { auditEntry: () => ({}), writeAuditEntry: async () => {} },
    "@/lib/permissions": { requirePermission: async (permission) => { assert.equal(permission, "edit_shop_settings"); if (!allowed) throw new Error("denied"); return { user: { id: "owner" }, membership: { shopId: "shop-a", role: "OWNER", shop: { name: "Example Shop" } } }; } },
    "@/lib/prisma": { prisma: { $transaction: async (callback) => callback({ shop: { update: async (write) => writes.push(write) } }) } },
    "@/lib/marketing-lead-notification-settings": settings,
  });
  const form = new FormData();
  form.set("shopId", "shop-b");
  form.set("marketingLeadNotifyEmail1", " OWNER@EXAMPLE.test ");
  form.set("marketingLeadNotifyEmail2", "SECOND@EXAMPLE.test");
  form.set("marketingLeadEmailNotificationsEnabled", "on");
  await assert.rejects(actions.updateLeadNotificationSettings({}, form), /denied/);
  assert.equal(writes.length, 0);
  allowed = true;
  assert.deepEqual(await actions.updateLeadNotificationSettings({}, form), { saved: true });
  assert.deepEqual(writes[0], { where: { id: "shop-a" }, data: { marketingLeadNotifyEmail1: "owner@example.test", marketingLeadNotifyEmail2: "second@example.test", marketingLeadEmailNotificationsEnabled: true, marketingLeadInAppNotificationsEnabled: false } });
  form.set("marketingLeadNotifyEmail2", "invalid");
  assert.ok((await actions.updateLeadNotificationSettings({}, form)).error);
  assert.equal(writes.length, 1);
});

test("existing scheduling email content and prerequisites remain intact", async () => {
  const sent = [];
  const notifier = await load("src/lib/marketing-lead-notifications.ts", {
    "@/lib/prisma": {}, "@/lib/marketing-lead-notification-settings": settings,
    "@/lib/email/resend": { sendResendEmail: async (message) => { sent.push(message); return { ok: true, id: "email" }; } },
  });
  await notifier.notifyScheduledMarketingLead(lead);
  assert.equal(sent.length, 0);
  await notifier.notifyScheduledMarketingLead({ ...lead, scheduledDate: new Date("2026-10-02"), scheduledTime: "09:30" });
  assert.equal(sent[0].subject, "Your repair appointment is scheduled");
  assert.equal(sent[0].to, lead.email);
  assert.match(sent[0].text, /2026-10-02 at 09:30/);
});

test("notification sender respects disabled email and actually uses the environment fallback", async () => {
  for (const enabled of [true, false]) {
    const sent = [];
    const notifier = await load("src/lib/marketing-lead-notifications.ts", {
      "@/lib/prisma": { prisma: { shop: { findUniqueOrThrow: async () => ({ ...defaults, marketingLeadEmailNotificationsEnabled: enabled }) } } },
      "@/lib/marketing-lead-notification-settings": settings,
      "@/lib/email/resend": { sendResendEmail: async (message) => { sent.push(message); return { ok: true, id: "email" }; } },
    }, { MARKETING_LEADS_NOTIFY_EMAIL: " Fallback@Example.test " });
    await notifier.notifyNewMarketingLead(lead);
    assert.deepEqual(sent.map((message) => message.to), enabled ? ["fallback@example.test"] : []);
  }
});

test("mark all does not silently read notifications newer than the displayed snapshot", async () => {
  const center = await centerHarness();
  const snapshot = await center.getLeadNotificationState();
  center.rows.push({ ...center.rows[0], id: "20000000-0000-0000-0000-000000000003", createdAt: new Date(Date.parse(snapshot.asOf) + 1_000) });
  await center.readAllLeadNotifications(snapshot.asOf);
  assert.equal(center.reads.length, 1);
  assert.equal(center.reads[0].notificationId, center.rows[0].id);
});

for (const scenario of [
  { name: "database accepted", db: " Owner@Example.test ", source: "DATABASE", outcome: { ok: true, id: "resend-safe-id" }, result: "accepted" },
  { name: "fallback accepted", source: "FALLBACK", outcome: { ok: true, id: "resend-safe-id" }, result: "accepted" },
  { name: "database rejected", db: "owner@example.test", source: "DATABASE", outcome: { ok: false, code: "request_rejected" }, result: "failed", code: "request_rejected" },
  { name: "thrown error is sanitized", db: "owner@example.test", source: "DATABASE", throws: true, result: "failed", code: "unexpected_error" },
  { name: "disabled skips fallback", enabled: false, source: null, result: "skipped", code: "notifications_disabled" },
  { name: "no recipient", noFallback: true, source: null, result: "skipped", code: "no_recipient" },
]) {
  test(`safe email observability: ${scenario.name}`, async () => {
    const logs = [];
    let sends = 0;
    const notifier = await load("src/lib/marketing-lead-notifications.ts", {
      "@/lib/prisma": { prisma: { shop: { findUniqueOrThrow: async () => ({ ...defaults, marketingLeadEmailNotificationsEnabled: scenario.enabled ?? true, marketingLeadNotifyEmail1: scenario.db ?? null }) } } },
      "@/lib/marketing-lead-notification-settings": settings,
      "@/lib/email/resend": { sendResendEmail: async () => { sends++; if (scenario.throws) throw new Error(`private-secret ${lead.email} ${lead.message}`); return scenario.outcome; } },
    }, { MARKETING_LEADS_NOTIFY_EMAIL: scenario.noFallback ? "" : "fallback@example.test" }, {
      info: (record) => logs.push(record), error: (record) => logs.push(record),
    });
    await notifier.notifyNewMarketingLead(lead);
    assert.equal(sends, scenario.result === "skipped" ? 0 : 1);
    assert.deepEqual(logs, [{ event: "marketing_lead_email", leadId: lead.id, source: lead.source, recipientSource: scenario.source, recipientCount: sends, result: scenario.result, ...(sends ? { recipientIndex: 1 } : {}), ...(scenario.code ? { code: scenario.code } : { resendId: "resend-safe-id" }) }]);
    for (const sensitive of [lead.name, lead.phone, lead.email, lead.message, "owner@example.test", "fallback@example.test", "private-secret"]) assert.ok(!JSON.stringify(logs).includes(sensitive));
  });
}

for (const [action, path] of [["submitContactLead", "/contact"], ["submitAppointmentLead", "/appointment"], ["submitDropOffLead", "/drop-off"]]) {
  test(`${action} requires phone, valid email and an intentional contact preference; persists all choices`, async () => {
    const saved = [];
    const actions = await load("src/app/(marketing)/lead-actions.ts", {
      "next/navigation": { redirect: (url) => { throw new Error(url); } },
      "next/headers": { cookies: async () => ({ get: () => undefined }) },
      "@/lib/prisma": { prisma: { shop: { findMany: async () => [{ id: "shop-a" }] } } },
      "@/lib/marketing-attribution": await load("src/lib/marketing-attribution.ts"),
      "@/lib/marketing-lead-submission": { storeMarketingLead: async (record) => saved.push(record) },
    });
    const valid = { name: "Example Visitor", phone: "555-0100", email: " Visitor@Example.test ", preferredContactMethod: "TEXT", vehicleYear: "2021", vehicleMake: "Example", vehicleModel: "Sedan", requestedService: "Brakes", preferredDate: "2026-10-01", message: "Please contact me" };
    for (const overrides of [{ phone: "" }, { email: "" }, { email: "bad" }, { preferredContactMethod: "" }, { preferredContactMethod: "SMS" }, { preferredContactMethod: "__proto__" }]) {
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...valid, ...overrides })) form.set(key, value);
      await assert.rejects(actions[action](form), { message: `${path}?error=1` });
      assert.equal(saved.length, 0);
    }
    for (const method of ["TEXT", "PHONE_CALL", "EMAIL"]) {
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...valid, preferredContactMethod: method })) form.set(key, value);
      await assert.rejects(actions[action](form), { message: `${path}?sent=1` });
      assert.equal(saved.at(-1).preferredContactMethod, method);
      assert.equal(saved.at(-1).email, "visitor@example.test");
      assert.equal(saved.at(-1).preferredDate.toISOString(), "2026-10-01T00:00:00.000Z");
    }
  });
}

test("each database recipient gets an indexed result even when the first fails", async () => {
  const sent = [], logs = [];
  const notifier = await load("src/lib/marketing-lead-notifications.ts", {
    "@/lib/prisma": { prisma: { shop: { findUniqueOrThrow: async () => ({ ...defaults, marketingLeadNotifyEmail1: "one@example.test", marketingLeadNotifyEmail2: "two@example.test" }) } } },
    "@/lib/email/resend": { sendResendEmail: async ({ to }) => { sent.push(to); return to === "one@example.test" ? { ok: false, code: "request_rejected" } : { ok: true, id: "second-id" }; } },
    "@/lib/marketing-lead-notification-settings": settings,
  }, {}, { info: (record) => logs.push(record), error: (record) => logs.push(record) });
  await notifier.notifyNewMarketingLead(lead);
  assert.deepEqual(sent, ["one@example.test", "two@example.test"]);
  assert.deepEqual(logs.map(({ recipientIndex, recipientCount, recipientSource, result }) => ({ recipientIndex, recipientCount, recipientSource, result })), [
    { recipientIndex: 1, recipientCount: 2, recipientSource: "DATABASE", result: "failed" },
    { recipientIndex: 2, recipientCount: 2, recipientSource: "DATABASE", result: "accepted" },
  ]);
  assert.equal(logs[0].code, "request_rejected");
  assert.equal(logs[1].resendId, "second-id");
  assert.ok(!JSON.stringify(logs).includes("@"));
});

for (const method of [null, "TEXT", "PHONE_CALL", "EMAIL"]) {
  test(`owner email safely presents preference ${method}`, async () => {
    const sent = [];
    const notifier = await load("src/lib/marketing-lead-notifications.ts", {
      "@/lib/prisma": { prisma: { shop: { findUniqueOrThrow: async () => ({ ...defaults, marketingLeadNotifyEmail1: "one@example.test" }) } } },
      "@/lib/email/resend": { sendResendEmail: async (message) => { sent.push(message); return { ok: true, id: "email-id" }; } },
      "@/lib/marketing-lead-notification-settings": settings,
    });
    await notifier.notifyNewMarketingLead({ ...lead, preferredContactMethod: method });
    assert.ok(sent[0].text.includes(`Preferred contact method: ${method ? contactMethods.leadContactMethodLabels[method] : "Not specified"}`));
    assert.ok(!sent[0].text.includes(lead.id));
  });
}
