import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getBusinessProfile } from "../src/lib/business-profile.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("desktop sidebar reserves a viewport-height scroll region for every authorized navigation item", async () => {
  const [shell, navigation] = await Promise.all([
    read("src/components/app-shell.tsx"),
    read("src/components/app-navigation.tsx"),
  ]);
  assert.match(shell, /<aside className="[^"]*h-dvh[^"]*min-h-0[^"]*overflow-hidden[^"]*lg:flex[^"]*lg:flex-col/);
  assert.match(shell, /href="\/dashboard" className="[^"]*shrink-0/);
  assert.match(shell, /action="\/search" className="[^"]*shrink-0/);
  assert.match(shell, /mt-4 shrink-0 rounded-xl/);
  assert.match(navigation, /<nav className="[^"]*min-h-0[^"]*flex-1[^"]*overflow-x-hidden[^"]*overflow-y-auto[^"]*overscroll-contain/);
  assert.match(navigation, /href: "\/admin", label: "Admin", icon: Shield, module: "admin"/);
});

test("mobile navigation and permission filtering remain unchanged", async () => {
  const navigation = await read("src/components/app-navigation.tsx");
  assert.match(navigation, /className="flex gap-1 overflow-x-auto border-t border-slate-200 px-3 py-2"/);
  assert.match(navigation, /allowedNavigation\(canViewReports, canViewAdmin\)/);
  assert.match(navigation, /item\.href !== "\/reports" \|\| canViewReports/);
  assert.match(navigation, /!\["\/", "\/admin"\]\.includes\(item\.href\) \|\| canViewAdmin/);
});

test("desktop and mobile share the customer-requested navigation order", async () => {
  const source = await read("src/components/app-navigation.tsx");
  const orderedRoutes = [...source.matchAll(/\{ href: "([^"]+)", label: [^,]+, icon: \w+, module:/g)].map((match) => match[1]);
  assert.deepEqual(orderedRoutes, ["/repair-orders", "/invoices", "/customers", "/vehicles", "/", "/dashboard", "/reports", "/admin", "/help", "/accounts-receivable"]);
  const profile = getBusinessProfile();
  assert.equal(profile.terminology.workOrderPlural, "Repair Orders");
  assert.equal(profile.terminology.assetPlural, "Vehicles");
  assert.match(source, /label: terminology\.workOrderPlural/);
  assert.match(source, /label: terminology\.assetPlural/);
  assert.match(source, /item\.module === null \|\| businessProfile\.modules\[item\.module\]/);
  assert.equal((source.match(/allowedNavigation\(canViewReports, canViewAdmin\)\.map/g) ?? []).length, 2);
});
