import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const matrix = require("../src/lib/permission-matrix.json");
const statuses = Object.fromEntries(["NEW", "CONTACTED", "SCHEDULED", "CONVERTED", "CLOSED"].map((status) => [status, status]));
const jsx = (type, props) => ({ type, props });
const runtime = { jsx, jsxs: jsx };
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(await read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((id) => {
    if (id === "server-only") return {};
    if (id === "@/lib/marketing-lead-contact") return contactMethods;
    if (id === "react/jsx-runtime") return runtime;
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const contactMethods = await load("src/lib/marketing-lead-contact.ts");
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
const membership = (role = "STAFF") => ({ user: { id: "user-a" }, membership: { shopId: "shop-a", role } });
async function permissions(access) {
  return load("src/lib/permissions.ts", { "@/lib/permission-matrix.json": { default: matrix }, "@/lib/data/membership": { getCurrentMembership: async () => access } });
}

for (const role of ["STAFF", "ADMIN", "OWNER"]) {
  test(`${role} can review and manage leads with narrowly scoped permissions`, async () => {
    const p = await permissions(membership(role));
    assert.ok(await p.requirePermission("view_marketing_leads"));
    assert.ok(await p.requirePermission("manage_marketing_leads"));
    assert.equal(p.hasPermission(role, "edit_shop_settings"), role !== "STAFF");
    if (role === "STAFF") await assert.rejects(p.requirePermission("edit_shop_settings"));
  });
}

for (const mobile of [false, true]) {
  for (const count of [0, 3]) {
    test(`${mobile ? "mobile" : "desktop"} Leads navigation uses shared unread count ${count}`, async () => {
      const navigation = await load("src/components/app-navigation.tsx", {
        "next/link": { default: "a" }, "next/navigation": { usePathname: () => "/leads/example" },
        "@/components/lead-notification-provider": { useLeadNotifications: () => ({ state: { unreadCount: count } }) },
        "@/lib/business-profile": { getBusinessProfile: () => ({ terminology: { workOrderPlural: "Repair Orders", assetPlural: "Vehicles" }, modules: { workOrders: true, invoices: true, customers: true, assets: true, reports: true, admin: true, accountsReceivable: true } }) },
      });
      const tree = (mobile ? navigation.MobileNavigation : navigation.DesktopNavigation)({ canViewReports: false, canViewAdmin: false });
      const rendered = nodes(tree);
      const link = rendered.find((node) => node.type === "a" && node.props.href === "/leads");
      assert.ok(link);
      assert.equal(link.props["aria-current"], "page");
      const badge = nodes(link).find((node) => node.props?.["aria-label"] === `${count} unread lead notifications`);
      assert.equal(Boolean(badge), count > 0);
      if (badge) { assert.equal(badge.props.children, count); assert.match(badge.props.className, /bg-orange-600.*text-white/); }
      assert.ok(!rendered.some((node) => node.type === "a" && node.props.href === "/admin"));
    });
  }
}

test("legacy Admin bookmark redirects to operational Leads and preserves filters", async () => {
  const config = (await load("next.config.ts")).default;
  const { unstable_getResponseFromNextConfig } = require("next/experimental/testing/server");
  const response = await unstable_getResponseFromNextConfig({ url: "https://www.subbuscardoc.com/admin/leads?status=NEW", nextConfig: config });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://www.subbuscardoc.com/leads?status=NEW");
  const tabs = await read("src/app/(app)/admin/admin-tabs.tsx");
  assert.doesNotMatch(tabs, /name: "Leads"/);
  const admin = await read("src/app/(app)/admin/layout.tsx");
  assert.match(admin, /hasPermission\(membership.role, "edit_shop_settings"\)/);
});

const lead = { id: "10000000-0000-0000-0000-000000000001", shopId: "shop-a", source: "APPOINTMENT", name: "Example Visitor", status: "NEW", scheduledDate: null, scheduledTime: null, internalNote: null, notification: { id: "alert-a", reads: [] } };

async function renderLeads(query = {}, records = [lead]) {
  const calls = [];
  const p = await permissions(membership());
  const presenter = await load("src/lib/marketing-lead-read-presentation.ts");
  const page = await load("src/app/(app)/leads/page.tsx", {
    "next/link": { default: "a" }, "@/generated/prisma/client": { MarketingLeadStatus: statuses },
    "@/components/page-heading": { PageHeading: "heading" },
    "@/lib/permissions": p, "@/lib/marketing-lead-read-presentation": presenter,
    "@/components/marketing-lead-card": { MarketingLeadCard: "lead-card" },
    "@/lib/prisma": { prisma: { marketingLead: {
      findMany: async (query) => { calls.push(query); return records.filter((record) => !query.where.status || record.status === query.where.status); },
      count: async ({ where }) => { assert.deepEqual(where, { shopId: "shop-a", status: "NEW" }); return 1; },
    } } },
  });
  const tree = await page.default({ searchParams: Promise.resolve(query) });
  return { tree, calls };
}

test("STAFF operational list is tenant scoped, newest first, filtered, and uses the shared management card", async () => {
  const { tree, calls } = await renderLeads({ status: "NEW", shopId: "shop-b" });
  assert.deepEqual(calls[0].where, { shopId: "shop-a", status: "NEW" });
  assert.deepEqual(calls[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(calls[0].include.notification.include.reads.where, { shopId: "shop-a", userId: "user-a" });
  const card = nodes(tree).find((node) => node.type === "lead-card");
  assert.equal(card.props.canManage, true);
  assert.equal(card.props.notification.read, false);
  assert.ok(nodes(tree).some((node) => node.props?.href === "/leads?status=NEW"));
  assert.ok(!nodes(tree).some((node) => node.props?.href?.startsWith("/admin")));
});


for (const query of [{}, { status: "NEW" }, { status: "invalid" }]) {
  test(`Leads defaults safely to NEW and selects New for ${JSON.stringify(query)}`, async () => {
    const { tree, calls } = await renderLeads(query);
    assert.deepEqual(calls[0].where, { shopId: "shop-a", status: "NEW" });
    const navigation = nodes(tree).find((node) => node.type === "nav" && node.props["aria-label"] === "Lead status");
    const tabs = nodes(navigation).filter((node) => node.type === "a");
    assert.deepEqual(tabs.map((tab) => tab.props.children), ["New", "Contacted", "Scheduled", "Converted", "Closed", "All"]);
    assert.deepEqual(tabs.filter((tab) => tab.props["aria-current"] === "page").map((tab) => tab.props.children), ["New"]);
    assert.match(tabs[0].props.className, /bg-brand-primary/);
    assert.equal(tabs.at(-1).props.href, "/leads?status=ALL");
  });
}

for (const status of Object.values(statuses)) {
  test(`explicit ${status} filter still returns and selects that status`, async () => {
    const records = Object.values(statuses).map((value) => ({ ...lead, id: value, status: value }));
    const { tree, calls } = await renderLeads({ status }, records);
    assert.equal(calls[0].where.status, status);
    assert.deepEqual(nodes(tree).filter((node) => node.type === "lead-card").map((node) => node.props.lead.status), [status]);
    const selected = nodes(tree).filter((node) => node.type === "a" && node.props["aria-current"] === "page");
    assert.equal(selected.length, 1);
    assert.equal(selected[0].props.href, `/leads?status=${status}`);
  });
}

test("ALL is selected last and returns every MarketingLead status", async () => {
  const records = Object.values(statuses).map((status) => ({ ...lead, id: status, status }));
  const { tree, calls } = await renderLeads({ status: "ALL" }, records);
  assert.deepEqual(calls[0].where, { shopId: "shop-a" });
  assert.deepEqual(nodes(tree).filter((node) => node.type === "lead-card").map((node) => node.props.lead.status), Object.values(statuses));
  const navigation = nodes(tree).find((node) => node.type === "nav" && node.props["aria-label"] === "Lead status");
  const tabs = nodes(navigation).filter((node) => node.type === "a");
  assert.equal(tabs.at(-1).props.children, "All");
  assert.equal(tabs.at(-1).props["aria-current"], "page");
  assert.match(tabs.at(-1).props.className, /bg-brand-primary/);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} primary Leads link resets prior filters to the default New view`, async () => {
    for (const previousStatus of ["CONTACTED", "SCHEDULED", "CONVERTED", "CLOSED", "ALL"]) {
      const navigation = await load("src/components/app-navigation.tsx", {
        "next/link": { default: "a" }, "next/navigation": { usePathname: () => "/leads" },
        "@/components/lead-notification-provider": { useLeadNotifications: () => ({ state: { unreadCount: 0 } }) },
        "@/lib/business-profile": { getBusinessProfile: () => ({ terminology: { workOrderPlural: "Repair Orders", assetPlural: "Vehicles" }, modules: {} }) },
      });
      const tree = (mobile ? navigation.MobileNavigation : navigation.DesktopNavigation)({ canViewReports: false, canViewAdmin: false });
      const link = nodes(tree).find((node) => node.type === "a" && node.props.href === "/leads");
      assert.ok(link);
      const destination = new URL(link.props.href, `https://www.subbuscardoc.com/leads?status=${previousStatus}`);
      assert.equal(destination.search, "");
      const result = await renderLeads(Object.fromEntries(destination.searchParams));
      assert.equal(result.calls[0].where.status, "NEW");
    }
  });
}

test("lead detail uses the same management card without an Admin detour", async () => {
  const p = await permissions(membership());
  const page = await load("src/app/(app)/leads/[id]/page.tsx", {
    "next/link": { default: "a" }, "next/navigation": { notFound: () => { throw new Error("404"); } },
    "@/lib/marketing-lead-notification-center": { getOperationalLead: async () => ({ lead, role: "STAFF" }) },
    "@/lib/permissions": p, "@/components/page-heading": { PageHeading: "heading" },
    "@/components/marketing-lead-card": { MarketingLeadCard: "lead-card" },
    "@/lib/marketing-lead-read-presentation": await load("src/lib/marketing-lead-read-presentation.ts"),
  });
  const tree = await page.default({ params: Promise.resolve({ id: lead.id }) });
  const card = nodes(tree).find((node) => node.type === "lead-card");
  assert.equal(card.props.canManage, true);
  assert.equal(card.props.lead, lead);
  assert.ok(!nodes(tree).some((node) => node.props?.href?.startsWith("/admin")));
});

test("STAFF lead updates preserve scheduling email and never mutate notification reads", async () => {
  let saved = { ...lead };
  const scheduledEmails = [], revalidations = [];
  const p = await permissions(membership());
  const transaction = { marketingLead: {
    updateMany: async ({ where, data }) => { assert.equal(where.shopId, "shop-a"); if (where.id !== saved.id) return { count: 0 }; saved = { ...saved, ...data }; return { count: 1 }; },
    findFirstOrThrow: async ({ where }) => { assert.deepEqual(where, { id: lead.id, shopId: "shop-a" }); return saved; },
  } };
  const actions = await load("src/app/(app)/leads/manage-actions.ts", {
    "next/cache": { revalidatePath: (path) => revalidations.push(path) },
    "@/generated/prisma/client": { MarketingLeadStatus: statuses }, "@/lib/permissions": p,
    "@/lib/prisma": { prisma: { $transaction: async (callback) => callback(transaction) } },
    "@/lib/marketing-lead-notifications": { notifyScheduledMarketingLead: async (record) => scheduledEmails.push(record) },
  });
  const originalReads = structuredClone(saved.notification);
  const form = new FormData();
  for (const [key, value] of Object.entries({ id: lead.id, shopId: "shop-b", status: "SCHEDULED", scheduledDate: "2026-10-01", scheduledTime: "10:00", internalNote: "Call before arrival" })) form.set(key, value);
  await actions.updateLeadStatus(form);
  assert.equal(saved.status, "SCHEDULED");
  assert.equal(saved.scheduledDate.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(saved.scheduledTime, "10:00");
  assert.equal(saved.internalNote, "Call before arrival");
  assert.deepEqual(saved.notification, originalReads);
  assert.equal(scheduledEmails.length, 1);
  assert.ok(revalidations.includes("/leads"));
  assert.ok(revalidations.includes(`/leads/${lead.id}`));
  form.set("id", "10000000-0000-0000-0000-000000000099");
  await assert.rejects(actions.updateLeadStatus(form), /not found/);
  assert.equal(scheduledEmails.length, 1);
});

test("Dashboard remains a NEW-lead summary and owner email points directly to Leads", async () => {
  const [dashboard, data, email] = await Promise.all([read("src/app/(app)/dashboard/page.tsx"), read("src/lib/data/dashboard.ts"), read("src/lib/marketing-lead-notifications.ts")]);
  assert.match(dashboard, /"\/leads\?status=NEW"/);
  assert.match(data, /hasPermission\(membership.role, "view_marketing_leads"\)/);
  assert.match(data, /status: "NEW", NOT: \{ source: "CONTACT", message: callClickMessage \}/);
  assert.match(email, /View Leads in PlumWorks/);
  assert.match(email, /`\$\{siteUrl\}\/leads`/);
  assert.doesNotMatch(email, /Admin → Leads|\/admin\/leads/);
});

test("the shared card retains all lead sources, statuses, contact information and scheduling/note fields", async () => {
  const updateLeadStatus = () => {};
  const card = await load("src/components/marketing-lead-card.tsx", {
    "next/link": { default: "a" }, "@/generated/prisma/client": { MarketingLeadStatus: statuses },
    "@/app/(app)/leads/manage-actions": { updateLeadStatus },
    "@/lib/marketing-lead-context": { callClickMessage: "Call click" },
    "@/components/lead-read-control": { LeadReadControl: "read-control" },
  });
  for (const source of ["CONTACT", "APPOINTMENT", "DROP_OFF"]) {
    const record = { ...lead, source, phone: "555-0100", email: "visitor@example.test", vehicleYear: 2021, vehicleMake: "Example", vehicleModel: "Sedan", requestedService: "Brakes", message: "Please call", createdAt: new Date(), preferredDate: new Date("2026-10-01"), preferredTime: "10:00", scheduledDate: new Date("2026-10-02"), scheduledTime: "11:00", internalNote: "Confirm arrival" };
    const rendered = nodes(card.MarketingLeadCard({ lead: record, notification: { id: "alert-a", leadId: lead.id, read: false }, canManage: true }));
    assert.ok(rendered.some((node) => node.type === "form" && node.props.action === updateLeadStatus));
    assert.deepEqual(rendered.filter((node) => node.type === "option").map((node) => node.props.value), Object.values(statuses));
    for (const name of ["id", "status", "scheduledDate", "scheduledTime", "internalNote"]) assert.ok(rendered.some((node) => node.props?.name === name));
    assert.ok(rendered.some((node) => node.props?.children === record.phone));
    assert.ok(!rendered.some((node) => node.props?.href?.startsWith("tel:")));
    assert.ok(rendered.some((node) => node.props?.children === record.email));
    assert.ok(!rendered.some((node) => node.props?.href?.startsWith("mailto:")));
    assert.equal(rendered.find((node) => node.props?.name === "internalNote").props.defaultValue, "Confirm arrival");
    assert.ok(!nodes(card.MarketingLeadCard({ lead: record, notification: null, canManage: false })).some((node) => node.type === "form"));
  }
});

for (const [source, time, expected] of [["APPOINTMENT", "10:30", "10:30 AM"], ["APPOINTMENT", null, "No time preference"], ["APPOINTMENT", "00:00", "12:00 AM"], ["APPOINTMENT", "12:15", "12:15 PM"], ["CONTACT", null, null], ["DROP_OFF", null, null]]) {
  test(`${source} requested appointment presentation with time ${time}`, async () => {
    const card = await load("src/components/marketing-lead-card.tsx", {
      "next/link": { default: "a" }, "@/generated/prisma/client": { MarketingLeadStatus: statuses },
      "@/app/(app)/leads/manage-actions": { updateLeadStatus: () => { throw new Error("must not save on render"); } },
      "@/lib/marketing-lead-context": { callClickMessage: "Call click" },
      "@/components/lead-read-control": { LeadReadControl: "read-control" },
    });
    const record = { ...lead, source, createdAt: new Date("2026-09-21T17:00:00Z"), preferredDate: new Date("2026-09-23T00:00:00Z"), preferredTime: time };
    const notification = { id: "alert-a", leadId: lead.id, read: false };
    const rendered = nodes(card.MarketingLeadCard({ lead: record, notification, canManage: true }));
    const callout = rendered.find((node) => node.type === "section" && node.props["aria-label"] === "Requested Appointment");
    assert.equal(Boolean(callout), source === "APPOINTMENT");
    if (callout) {
      const content = nodes(callout);
      assert.ok(content.some((node) => node.type === "h3" && node.props.children === "Requested Appointment"));
      assert.ok(content.some((node) => node.props.children === "Wednesday, September 23, 2026" && /text-lg font-black/.test(node.props.className)));
      assert.ok(content.some((node) => node.props.children === expected));
      assert.ok(content.some((node) => typeof node.props.children === "string" && node.props.children.includes("not a confirmed appointment")));
      assert.ok(rendered.indexOf(callout) < rendered.findIndex((node) => node.type === "form"));
    }
    assert.equal(rendered.find((node) => node.props.name === "scheduledDate").props.defaultValue, "");
    assert.equal(rendered.find((node) => node.props.name === "scheduledTime").props.defaultValue, "");
    assert.equal(rendered.find((node) => node.props.name === "status").props.defaultValue, "NEW");
    assert.equal(rendered.find((node) => node.type === "read-control").props.notification, notification);
    assert.equal(record.status, "NEW");
    assert.equal(record.scheduledDate, null);
  });
}

for (const source of ["CONTACT", "APPOINTMENT", "DROP_OFF"]) {
  test(`${source} browser form requires email and unselected contact method`, async () => {
    const { LeadForm } = await load("src/components/marketing/lead-form.tsx", { "@/app/(marketing)/lead-actions": {} });
    const rendered = nodes(LeadForm({ source }));
    for (const name of ["name", "phone", "email"]) assert.equal(rendered.find((n) => n.props.name === name).props.required, true);
    const radios = rendered.filter((n) => n.props.name === "preferredContactMethod");
    assert.deepEqual(radios.map((n) => n.props.value), ["TEXT", "PHONE_CALL", "EMAIL"]);
    for (const radio of radios) { assert.equal(radio.props.type, "radio"); assert.equal(radio.props.required, true); assert.ok(!radio.props.defaultChecked && !radio.props.checked); }
  });
}

for (const method of [null, "TEXT", "PHONE_CALL", "EMAIL"]) {
  test(`shared list/detail card presents preference ${method} without contact action buttons`, async () => {
    const { MarketingLeadCard } = await load("src/components/marketing-lead-card.tsx", {
      "next/link": { default: "a" }, "@/generated/prisma/client": { MarketingLeadStatus: statuses },
      "@/app/(app)/leads/manage-actions": { updateLeadStatus() {} },
      "@/lib/marketing-lead-context": { callClickMessage: "Call click" },
      "@/components/lead-read-control": { LeadReadControl: "read-control" },
    });
    const rendered = nodes(MarketingLeadCard({ lead: { ...lead, createdAt: new Date(), preferredContactMethod: method, phone: "555-0100", email: "visitor@example.test" }, notification: null, canManage: true }));
    assert.equal(rendered.some((n) => n.props.children === "Preferred contact"), method !== null);
    if (method) assert.ok(rendered.some((n) => n.props.children === contactMethods.leadContactMethodLabels[method]));
    assert.ok(!rendered.some((n) => /^(tel:|mailto:)/.test(n.props.href ?? "")));
    assert.ok(rendered.some((n) => n.props.children === "555-0100"));
    assert.ok(rendered.some((n) => n.props.children === "visitor@example.test"));
  });
}
