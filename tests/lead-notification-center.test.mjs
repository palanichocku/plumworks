import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Execute the actual component with deterministic hooks, browser events, and server actions.
// No database, user session, or external email is used.
async function harness(storage = new Map()) {
  const hooks = [], effects = [], listeners = new Map(), timers = [], toasts = [], routes = [];
  let index = 0, calls = 0, reads = 0, readAll = 0;
  let next = { enabled: true, unreadCount: 1, asOf: new Date().toISOString(), items: [{ id: "alert-1", leadId: "lead-1", read: false, name: "Example Visitor", source: "APPOINTMENT", vehicle: "2021 Example Sedan", status: "NEW", createdAt: new Date().toISOString() }] };
  const add = (name, handler) => listeners.set(name, handler);
  const remove = (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); };
  const document = { visibilityState: "visible", addEventListener: add, removeEventListener: remove };
  const window = { setInterval: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearInterval() {}, addEventListener: add, removeEventListener: remove };
  let context;
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    useContext: () => context,
    useState(initial) {
      const key = index++;
      if (!(key in hooks)) hooks[key] = initial;
      return [hooks[key], (value) => { hooks[key] = typeof value === "function" ? value(hooks[key]) : value; }];
    },
    useRef(initial) { const key = index++; if (!(key in hooks)) hooks[key] = { current: initial }; return hooks[key]; },
    useCallback(fn, dependencies) {
      const key = index++;
      if (!hooks[key] || dependencies.some((dep, i) => dep !== hooks[key].dependencies[i])) hooks[key] = { fn, dependencies };
      return hooks[key].fn;
    },
    useEffect(fn, dependencies) {
      const key = index++;
      if (!hooks[key] || dependencies.some((dep, i) => dep !== hooks[key].dependencies[i])) {
        hooks[key]?.cleanup?.();
        hooks[key] = { dependencies };
        effects.push(() => { hooks[key].cleanup = fn(); });
      }
    },
  };
  const transportEvents = [];
  const router = { push: (path) => { transportEvents.push({ type: "navigate", path }); routes.push(path); } };
  const toast = Object.assign((message) => toasts.push(message), { custom: (render, options) => toasts.push({ render, options }), dismiss() {}, error: (message) => toasts.push({ error: message }) });
  const jsx = (type, props) => ({ type, props });
  const actions = {
    fetchLeadNotifications: async () => { calls++; return structuredClone(next); },
    persistRead: async (id) => { reads++; const target = next.items.find((item) => item.id === id); next = { ...next, unreadCount: Math.max(0, next.unreadCount - (target?.read === false ? 1 : 0)), items: next.items.map((item) => item.id === id ? { ...item, read: true } : item) }; return { href: `/leads/${target?.leadId}` }; },
    markAllLeadNotificationsRead: async (asOf) => { assert.equal(asOf, next.asOf); readAll++; next = { ...next, unreadCount: 0, items: next.items.map((item) => ({ ...item, read: true })) }; },
  };
  const dependencies = { "@/components/lead-notification-provider": { useLeadNotifications: () => context }, react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/navigation": { useRouter: () => router, usePathname: () => "/customers" }, "react-hot-toast": { default: toast, Toaster() {} }, "@/app/(app)/leads/actions": actions };
  const source = await readFile(new URL("../src/components/lead-notification-provider.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "sessionStorage", "fetch", outputText)((id) => {
    assert.ok(dependencies[id], `Unknown dependency ${id}`); return dependencies[id];
  }, loaded, loaded.exports, window, document, { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }, async (url, options) => {
    transportEvents.push({ type: "post", url, options });
    assert.deepEqual(options, { method: "POST", cache: "no-store", keepalive: true, credentials: "same-origin" });
    const id = decodeURIComponent(url.match(/^\/api\/lead-notifications\/(.+)\/read$/)[1]);
    const result = await actions.persistRead(id);
    return result instanceof Response ? result : new Response(null, { status: 204 });
  });
  const centerSource = await readFile(new URL("../src/components/lead-notification-center.tsx", import.meta.url), "utf8");
  const centerCode = ts.transpileModule(centerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const center = { exports: {} };
  new Function("require", "module", "exports", "document", centerCode)((id) => dependencies[id], center, center.exports, document);
  dependencies["next/link"] = { default: "a" };
  dependencies["@/lib/business-profile"] = { getBusinessProfile: () => ({ terminology: { workOrderPlural: "Repair Orders", assetPlural: "Vehicles" }, modules: {} }) };
  const navigationCode = ts.transpileModule(await readFile(new URL("../src/components/app-navigation.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const navigation = { exports: {} };
  new Function("require", "module", "exports", navigationCode)((id) => dependencies[id], navigation, navigation.exports);
  const renderNavigation = (mobile = false) => (mobile ? navigation.exports.MobileNavigation : navigation.exports.DesktopNavigation)({ canViewReports: false, canViewAdmin: false });
  const render = () => {
    index = 0;
    const provider = loaded.exports.LeadNotificationProvider({ sessionKey: "shop:user", children: null });
    context = provider.props.value;
    const tree = center.exports.LeadNotificationCenter();
    while (effects.length) effects.shift()();
    return tree;
  };
  const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); };
  return { render, renderNavigation, flush, hooks, actions, transportEvents, context: () => context, document, listeners, timers, toasts, routes, storage, calls: () => calls, reads: () => reads, readAll: () => readAll, setNext: (state) => { next = state; }, next: () => structuredClone(next) };
}
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

test("polling is every 20 seconds, skips hidden tabs, refreshes on focus and visibility, and does not repeat toasts", async () => {
  const h = await harness();
  h.render(); await h.flush();
  assert.equal(h.calls(), 1);
  assert.equal(h.timers[0].delay, 20_000);
  assert.equal(h.toasts.length, 1);
  await h.timers[0].fn(); await h.flush();
  assert.equal(h.toasts.length, 1);
  h.document.visibilityState = "hidden";
  await h.timers[0].fn(); await h.flush();
  assert.equal(h.calls(), 2);
  const state = h.next(); state.items[0].id = "alert-2"; h.setNext(state);
  h.document.visibilityState = "visible";
  h.listeners.get("visibilitychange")(); await h.flush();
  assert.equal(h.calls(), 3);
  assert.equal(h.toasts.length, 2);
  h.listeners.get("focus")(); await h.flush();
  assert.equal(h.calls(), 4);
  assert.equal(h.toasts.length, 2);
  const remount = await harness(h.storage);
  remount.render(); await remount.flush();
  assert.equal(remount.toasts.length, 0, "session storage survives component remounts");
});

test("toast View Lead marks read, updates the badge, and navigates to the operational lead", async () => {
  const h = await harness();
  h.render(); await h.flush();
  const tree = h.toasts[0].render({ visible: true, id: "toast" });
  const view = elements(tree).find((node) => node.type === "button" && node.props.children === "View Lead");
  view.props.onClick(); await h.flush();
  assert.equal(h.reads(), 1);
  assert.equal(h.hooks[0].unreadCount, 0);
  assert.deepEqual(h.routes, ["/leads/lead-1"]);
});

test("bell opens recent alerts and mark all clears per-user state without navigation", async () => {
  const h = await harness();
  let tree = h.render(); await h.flush();
  const bell = elements(tree).find((node) => node.props?.["aria-controls"] === "lead-notification-panel");
  bell.props.onClick();
  tree = h.render();
  assert.ok(elements(tree).some((node) => node.props?.id === "lead-notification-panel"));
  const markAll = elements(tree).find((node) => node.type === "button" && node.props.children === "Mark all as read");
  markAll.props.onClick(); await h.flush();
  assert.equal(h.readAll(), 1);
  assert.equal(h.hooks[0].unreadCount, 0);
  assert.deepEqual(h.routes, []);
});

test("one provider keeps bell and both navigation badges synchronized without additional polls", async () => {
  const h = await harness();
  const resolve = (tree) => {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap(resolve);
    if (typeof tree.type === "function") return resolve(tree.type(tree.props));
    return [tree, ...resolve(tree.props?.children)];
  };
  h.render(); await h.flush();
  let bellTree = h.render();
  assert.equal(h.calls(), 1);
  for (const mobile of [false, true]) {
    assert.ok(resolve(h.renderNavigation(mobile)).some((node) => node.props?.["aria-label"] === "1 unread lead notifications"));
  }
  assert.ok(elements(bellTree).some((node) => node.props?.["aria-label"] === "Lead notifications, 1 unread"));
  assert.equal(h.calls(), 1, "navigation only consumes context");
  const toastTree = h.toasts[0].render({ visible: true, id: "toast" });
  elements(toastTree).find((node) => node.type === "button" && node.props.children === "View Lead").props.onClick();
  await h.flush();
  bellTree = h.render();
  assert.ok(elements(bellTree).some((node) => node.props?.["aria-label"] === "Lead notifications, 0 unread"));
  for (const mobile of [false, true]) assert.ok(!resolve(h.renderNavigation(mobile)).some((node) => node.props?.["aria-label"]?.endsWith("unread lead notifications")));
  assert.equal(h.calls(), 2, "one initial request plus the existing post-read refresh");
  assert.equal(h.timers.length, 1);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function twoAlerts() {
  const h = await harness();
  const next = h.next();
  next.items.push({ ...next.items[0], id: "alert-2", leadId: "lead-2", name: "Second Visitor" });
  next.unreadCount = 2; h.setNext(next);
  h.render(); await h.flush(); h.render();
  return h;
}
function clickAlert(h, name) {
  h.context().setOpen(true);
  const tree = h.render();
  const button = elements(tree).find((node) => node.type === "button" && elements(node).some((child) => child.type === "p" && child.props.children === name));
  assert.ok(button, `Missing notification for ${name}`);
  assert.ok(!button.props.disabled, "individual alerts must remain clickable");
  button.props.onClick();
  h.render();
  assert.equal(h.context().open, false, "panel closes synchronously");
}

test("two bell alerts navigate and update shared badges immediately while independent reads remain pending", async () => {
  const h = await twoAlerts();
  const gates = { "alert-1": deferred(), "alert-2": deferred() };
  const persist = h.actions.persistRead;
  h.actions.persistRead = async (id) => { await gates[id].promise; return persist(id); };
  clickAlert(h, "Example Visitor");
  assert.deepEqual(h.routes, ["/leads/lead-1"]);
  assert.equal(h.context().state.unreadCount, 1);
  assert.equal(h.context().state.items[0].read, true);
  assert.equal(h.reads(), 0, "persistence is still pending");
  clickAlert(h, "Second Visitor");
  assert.deepEqual(h.routes, ["/leads/lead-1", "/leads/lead-2"]);
  assert.equal(h.context().state.unreadCount, 0);
  assert.ok(h.context().state.items.every((item) => item.read));
  // Polling must not undo either optimistic read while writes are pending.
  await h.timers[0].fn(); await h.flush(); h.render();
  assert.equal(h.context().state.unreadCount, 0);
  gates['alert-2'].resolve(); await h.flush(); h.render();
  assert.equal(h.context().state.unreadCount, 0, "second completion preserves first pending read");
  gates['alert-1'].resolve(); await h.flush();
  const tree = h.render();
  assert.equal(h.reads(), 2);
  assert.ok(elements(tree).some((n) => n.props?.['aria-label'] === 'Lead notifications, 0 unread'));
  assert.equal(h.context().state.unreadCount, 0);
  clickAlert(h, "Example Visitor");
  assert.deepEqual(h.routes, ["/leads/lead-1", "/leads/lead-2", "/leads/lead-1"], "already-read items still navigate");
  await h.flush();
});

test("failed read still opens the lead and reconciles only that unread item", async () => {
  const h = await twoAlerts();
  const failure = deferred();
  const persist = h.actions.persistRead;
  h.actions.persistRead = (id) => id === 'alert-1' ? failure.promise : persist(id);
  clickAlert(h, "Example Visitor");
  clickAlert(h, "Second Visitor");
  await h.flush();
  failure.reject(new Error('write unavailable')); await h.flush(); h.render();
  assert.deepEqual(h.routes, ["/leads/lead-1", "/leads/lead-2"]);
  assert.equal(h.context().state.unreadCount, 1);
  assert.equal(h.context().state.items[0].read, false);
  assert.equal(h.context().state.items[1].read, true);
  assert.ok(h.toasts.some((t) => t.error === 'Lead opened, but the notification could not be marked read.'));
});

test("toast navigation is immediate and duplicate clicks coalesce only the pending write", async () => {
  const h = await twoAlerts();
  const gate = deferred(); let attempts = 0;
  const persist = h.actions.persistRead;
  h.actions.persistRead = async (id) => { attempts++; await gate.promise; return persist(id); };
  const tree = h.toasts[0].render({ visible: true, id: 'toast' });
  const button = elements(tree).find((n) => n.type === 'button' && n.props.children === 'View Lead');
  button.props.onClick(); button.props.onClick();
  assert.deepEqual(h.routes, ['/leads/lead-1', '/leads/lead-1']);
  assert.equal(attempts, 1);
  h.render(); assert.equal(h.context().state.unreadCount, 1);
  gate.resolve(); await h.flush();
});

test("Mark All and individual navigation remain independent in both directions", async () => {
  const h = await twoAlerts();
  const one = deferred(), all = deferred();
  const persist = h.actions.persistRead, persistAll = h.actions.markAllLeadNotificationsRead;
  h.actions.persistRead = async (id) => { await one.promise; return persist(id); };
  h.actions.markAllLeadNotificationsRead = async (asOf) => { await all.promise; return persistAll(asOf); };
  clickAlert(h, 'Example Visitor');
  const markAll = h.context().markAll(); h.render();
  assert.equal(h.context().markAllBusy, true);
  clickAlert(h, 'Second Visitor');
  assert.deepEqual(h.routes, ['/leads/lead-1', '/leads/lead-2']);
  all.resolve(); await markAll; h.render();
  assert.equal(h.context().markAllBusy, false);
  assert.equal(h.readAll(), 1);
  assert.equal(h.context().state.unreadCount, 0);
  one.resolve(); await h.flush(); h.render();
  assert.equal(h.reads(), 2);
  assert.equal(h.context().state.unreadCount, 0);
});

test("a stalled post-read refresh cannot block another alert or overwrite a later result", async () => {
  const h = await twoAlerts();
  const stale = deferred();
  const fetch = h.actions.fetchLeadNotifications;
  const oldSnapshot = h.next();
  let requests = 0;
  h.actions.fetchLeadNotifications = () => ++requests === 1 ? stale.promise : fetch();
  clickAlert(h, 'Example Visitor'); await h.flush();
  clickAlert(h, 'Second Visitor'); await h.flush(); h.render();
  assert.equal(h.context().state.unreadCount, 0);
  stale.resolve(oldSnapshot); await h.flush(); h.render();
  assert.equal(h.context().state.unreadCount, 0);
  assert.deepEqual(h.routes, ['/leads/lead-1', '/leads/lead-2']);
});

test("read reconciliation failure shows unavailable state and recovers on focus", async () => {
  const h = await twoAlerts();
  const fetch = h.actions.fetchLeadNotifications;
  h.actions.persistRead = async () => { throw new Error('read failed'); };
  h.actions.fetchLeadNotifications = async () => { throw new Error('refresh failed'); };
  clickAlert(h, 'Example Visitor'); await h.flush(); h.render();
  assert.deepEqual(h.routes, ['/leads/lead-1']);
  assert.equal(h.context().error, true);
  assert.equal(h.context().state, null);
  h.actions.fetchLeadNotifications = fetch;
  h.listeners.get('focus')(); await h.flush(); h.render();
  assert.equal(h.context().state.unreadCount, 2);
  assert.equal(h.context().error, false);
});


test("POST starts before navigation and non-2xx reconciles the optimistic read", async () => {
  const h = await twoAlerts();
  h.actions.persistRead = async () => Response.json({ error: "denied" }, { status: 403 });
  clickAlert(h, "Example Visitor");
  assert.deepEqual(h.transportEvents.map((e) => e.type), ["post", "navigate"]);
  await h.flush(); h.render();
  assert.equal(h.context().state.unreadCount, 2);
  assert.deepEqual(h.routes, ["/leads/lead-1"]);
  assert.ok(h.toasts.some((t) => t.error === "Lead opened, but the notification could not be marked read."));
});

test("detail mark-as-read uses POST without navigation and reports failures", async () => {
  const h = await twoAlerts();
  assert.equal(await h.context().viewLead(h.next().items[0], false), true);
  assert.deepEqual(h.routes, []);
  assert.equal(h.transportEvents[0].type, "post");
  h.render();
  h.actions.persistRead = async () => new Response(null, { status: 500 });
  assert.equal(await h.context().viewLead(h.next().items[1], false), false);
  h.render();
  assert.equal(h.context().state.unreadCount, 1);
  assert.ok(h.toasts.some((t) => t.error === "Could not mark this alert read. Please try again."));
});
