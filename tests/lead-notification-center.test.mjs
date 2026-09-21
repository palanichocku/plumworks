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
  const router = { push: (path) => routes.push(path) };
  const toast = Object.assign((message) => toasts.push(message), { custom: (render, options) => toasts.push({ render, options }), dismiss() {}, error: (message) => toasts.push({ error: message }) });
  const jsx = (type, props) => ({ type, props });
  const actions = {
    fetchLeadNotifications: async () => { calls++; return structuredClone(next); },
    markLeadNotificationRead: async (id) => { reads++; next = { ...next, unreadCount: 0, items: next.items.map((item) => item.id === id ? { ...item, read: true } : item) }; return { href: "/leads/lead-1" }; },
    markAllLeadNotificationsRead: async (asOf) => { assert.equal(asOf, next.asOf); readAll++; next = { ...next, unreadCount: 0, items: next.items.map((item) => ({ ...item, read: true })) }; },
  };
  const dependencies = { "@/components/lead-notification-provider": { useLeadNotifications: () => context }, react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/navigation": { useRouter: () => router, usePathname: () => "/customers" }, "react-hot-toast": { default: toast, Toaster() {} }, "@/app/(app)/leads/actions": actions };
  const source = await readFile(new URL("../src/components/lead-notification-provider.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "sessionStorage", outputText)((id) => {
    assert.ok(dependencies[id], `Unknown dependency ${id}`); return dependencies[id];
  }, loaded, loaded.exports, window, document, { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) });
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
  return { render, renderNavigation, flush, hooks, document, listeners, timers, toasts, routes, storage, calls: () => calls, reads: () => reads, readAll: () => readAll, setNext: (state) => { next = state; }, next: () => structuredClone(next) };
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
