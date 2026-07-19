import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aliasResolutionMaps,
  customerCreateData,
  manifestOrderSummary,
  planAliasRecovery,
  planCustomerRecovery,
  resolveLegacyCustomerId,
} from "./lib/legacy-customer-recovery.mjs";

const manifestPath = new URL("../../plumworks-deployments/clients/cardoc/imports/legacy-customer-recovery.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const baseCustomer = {
  id: "customer-1",
  legacyCustno: "PRIMARY",
  displayName: "EXAMPLE CUSTOMER",
  addressLine1: "123 MAIN ST.",
  phone: "555-111-2222",
  phone2: null,
};
const aliasEntry = {
  legacyCustomerId: "ALTERNATE",
  existingCustomerId: "customer-1",
  existingCustomerLegacyId: "PRIMARY",
  normalizedName: "EXAMPLE CUSTOMER",
  normalizedAddress: "123 MAIN ST",
};

test("exact customer legacy ID takes precedence over an identical alias", () => {
  const exact = new Map([["PRIMARY", "customer-1"]]);
  const aliases = new Map([["PRIMARY", "customer-1"]]);
  assert.equal(resolveLegacyCustomerId("PRIMARY", exact, aliases), "customer-1");
});

test("alias resolution succeeds and unknown IDs remain unresolved", () => {
  const maps = aliasResolutionMaps([baseCustomer], [{ aliasLegacyCustno: "ALTERNATE", customerId: "customer-1" }]);
  assert.equal(resolveLegacyCustomerId("ALTERNATE", maps.exactCustomerIds, maps.aliasCustomerIds), "customer-1");
  assert.equal(resolveLegacyCustomerId("UNKNOWN", maps.exactCustomerIds, maps.aliasCustomerIds), null);
});

test("conflicting exact and alias resolution fails", () => {
  assert.throws(
    () => resolveLegacyCustomerId("CONFLICT", new Map([["CONFLICT", "customer-1"]]), new Map([["CONFLICT", "customer-2"]])),
    /conflicting alias customer/,
  );
});

test("alias rerun is idempotent and a conflicting alias fails planning", () => {
  const unchanged = planAliasRecovery([aliasEntry], [baseCustomer], [{ aliasLegacyCustno: "ALTERNATE", customerId: "customer-1" }]);
  assert.deepEqual({ inserts: unchanged.inserts.length, unchanged: unchanged.unchanged.length, conflicts: unchanged.conflicts.length }, { inserts: 0, unchanged: 1, conflicts: 0 });
  const conflict = planAliasRecovery([aliasEntry], [baseCustomer], [{ aliasLegacyCustno: "ALTERNATE", customerId: "customer-2" }]);
  assert.equal(conflict.conflicts.length, 1);
});

test("historical customer rerun is idempotent and does not overwrite edited contact fields", () => {
  const entry = { legacyCustomerId: "HISTORICAL", displayName: "HISTORICAL NAME", phone: "555-111-2222", alternatePhone: null, address: "OLD ADDRESS", city: "OLD CITY", state: null, postalCode: null, classification: "normal-historical", notes: "source note" };
  const editedCustomer = { id: "historical-id", legacyCustno: "HISTORICAL", displayName: "HISTORICAL NAME", phone: "555-999-0000", phone2: null, addressLine1: "EDITED ADDRESS" };
  const plan = planCustomerRecovery([entry], [editedCustomer], []);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.inserts.length, 0);
  assert.equal(editedCustomer.phone, "555-999-0000");
  assert.equal(customerCreateData(entry, "shop-1").phone, "555-111-2222");
});

test("customer creation collision fails", () => {
  const entry = { legacyCustomerId: "NEW", displayName: "SAME NAME", phone: null, alternatePhone: null, address: "10 SAME ST", classification: "normal-historical" };
  const existing = { id: "existing", legacyCustno: "OTHER", displayName: "Same Name", addressLine1: "10 Same St.", phone: null, phone2: null };
  const plan = planCustomerRecovery([entry], [existing], []);
  assert.equal(plan.conflicts.length, 1);
  assert.match(plan.conflicts[0].reason, /name\/address collides/);
});

test("manifest accounts for 65 recoverable orders and only RO 18181 unresolved", () => {
  const summary = manifestOrderSummary(manifest);
  assert.equal(summary.aliasOrders.length, 9);
  assert.equal(summary.creationOrders.length, 56);
  assert.equal(summary.recoverableOrders.length, 65);
  assert.deepEqual(summary.unresolvedOrders, ["18181"]);
  assert.equal(manifest.unresolvedOrders[0].disposition, "keep-skipped");
});

test("all 66 affected orders predate 2025 and none is in 2025 or January-June 2026", () => {
  const datedOrders = `10114:20110330 10116:20110401 10132:20110501 10209:20110906 10251:20120107 10270:20120406 10272:20120407 10297:20120428 10323:20120507 10356:20120513 10412:20120528 10443:20120609 10510:20120626 10540:20120704 10565:20120705 10625:20120718 10660:20120729 10661:20120730 10671:20120802 10810:20120908 10848:20120920 10883:20120928 10912:20121007 11064:20121117 11128:20121204 11258:20130108 11300:20130120 11510:20130324 11806:20130616 11888:20130710 11948:20130729 12042:20130829 12199:20131022 12222:20131031 12327:20131203 12960:20140704 13271:20141023 13770:20150605 13872:20150721 14295:20160110 14328:20160128 14505:20160423 14661:20160706 14868:20161027 14884:20161101 14919:20161122 14996:20170219 15003:20170219 15037:20170115 15042:20170119 15142:20170319 15164:20170408 15405:20170816 15454:20170805 15473:20170816 15755:20180109 15828:20180214 15858:20180225 15984:20180422 16175:20180701 16530:20181111 17177:20190714 18125:20200829 18181:20200925 20175:20230525 20235:20230623`
    .split(" ").map((item) => item.split(":"));
  const summary = manifestOrderSummary(manifest);
  const manifestOrders = new Set([...summary.recoverableOrders, ...summary.unresolvedOrders]);
  assert.equal(datedOrders.length, 66);
  assert.deepEqual(new Set(datedOrders.map(([order]) => order)), manifestOrders);
  for (const [, rawDate] of datedOrders) {
    const year = Number(rawDate.slice(0, 4));
    assert.ok(year < 2025);
    assert.notEqual(year, 2025);
    assert.notEqual(year, 2026);
  }
});
