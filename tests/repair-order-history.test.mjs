import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, actionsUi, drawer, actions, loader, concerns, print, email] = await Promise.all([
  read("src/app/(app)/repair-orders/[id]/page.tsx"),
  read("src/components/email-repair-order-button.tsx"),
  read("src/components/repair-order-history-drawer.tsx"),
  read("src/app/(app)/repair-orders/history-actions.ts"),
  read("src/lib/data/repair-order-history.ts"),
  read("src/components/repair-order-concerns-form.tsx"),
  read("src/app/(app)/repair-orders/[id]/print/page.tsx"),
  read("src/lib/email/repair-order-email.tsx"),
]);

test("History remains a non-submitting in-page action ordered before Email and Print", () => {
  assert.match(page, /<EmailRepairOrderButton/);
  const marker = actionsUi.indexOf("data-repair-order-action-row");
  const row = actionsUi.slice(actionsUi.lastIndexOf("<div", marker), actionsUi.indexOf("{success ?"));
  assert.match(row, /\{status\}[\s\S]*History[\s\S]*Email[\s\S]*Print/);
  assert.match(row, /ref=\{historyButtonRef\}[\s\S]*type="button"[\s\S]*setHistoryOpen\(true\)/);
  assert.doesNotMatch(drawer + actionsUi, /router\.|window\.location|pushState|replaceState/);
  assert.match(actionsUi, /historyOpen \? <RepairOrderHistoryDrawer/);
});

test("drawer preserves mounted unsaved Repair Order form state", () => {
  assert.match(concerns, /const \[dirty, setDirty\] = useState\(false\)/);
  assert.match(drawer, /createPortal\(/);
  assert.doesNotMatch(drawer, /<form\b|revalidatePath|router\./);
  assert.doesNotMatch(actions, /revalidatePath|redirect/);
});

test("unified query authenticates through current RO and filters both sources by exact relational IDs", () => {
  assert.match(loader, /const \{ user, membership \} = await getCurrentMembership\(\)/);
  assert.match(loader, /if \(!user \|\| !membership\) return null/);
  assert.match(loader, /where: \{ id: currentRepairOrderId, shopId: membership\.shopId \}/);
  assert.match(loader, /select: \{ id: true, customerId: true, vehicleId: true \}/);
  for (const table of ["invoices i", "repair_orders ro"]) assert.match(loader, new RegExp(`FROM ${table}`));
  for (const prefix of ["i", "ro"]) {
    assert.match(loader, new RegExp(`${prefix}\\.shop_id = \\$\\{scope\\.shopId\\}`));
    assert.match(loader, new RegExp(`${prefix}\\.customer_id = \\$\\{scope\\.customerId\\}`));
    assert.match(loader, new RegExp(`${prefix}\\.vehicle_id = \\$\\{scope\\.vehicleId\\}`));
  }
  assert.doesNotMatch(loader, /display_name\s*=|vin\s*=|license_plate\s*=|legacy_custno\s*=|legacy_carno\s*=/i);
});

test("current RO is excluded and explicit Invoice relationship performs the only deduplication", () => {
  assert.match(loader, /ro\.id <> \$\{scope\.currentRepairOrderId\}/);
  assert.match(loader, /NOT EXISTS \([\s\S]*linked_invoice\.repair_order_id = ro\.id[\s\S]*\)/);
  assert.match(loader, /UNION ALL/);
  assert.doesNotMatch(loader, /repair_order_number\s*=|legacy_ro_no\s*=|service_date\s*=.*total/i);
  assert.match(loader, /i\.vehicle_id = \$\{scope\.vehicleId\}/);
  assert.doesNotMatch(loader.slice(loader.indexOf("FROM invoices i"), loader.indexOf("UNION ALL")), /repair_order_id IS NOT NULL/);
});

test("unified cursor provides deterministic global bounded pagination", () => {
  assert.match(loader, /COALESCE\(i\.invoice_date, i\.created_at\) AS service_date/);
  assert.match(loader, /ro\.opened_at AS service_date/);
  assert.match(loader, /ORDER BY service_date DESC, source_rank DESC, id DESC/);
  assert.match(loader, /\(service_date, source_rank, id\) < \(/);
  assert.match(loader, /LIMIT \$\{REPAIR_ORDER_HISTORY_PAGE_SIZE \+ 1\}/);
  assert.match(loader, /REPAIR_ORDER_HISTORY_PAGE_SIZE = 25/);
  assert.match(loader, /keys\.slice\(0, REPAIR_ORDER_HISTORY_PAGE_SIZE\)/);
  assert.match(loader, /keys\.length > REPAIR_ORDER_HISTORY_PAGE_SIZE/);
  assert.match(loader, /serviceDate: lastKey\.serviceDate\.toISOString\(\), source: lastKey\.source, id: lastKey\.id/);
  assert.doesNotMatch(loader, /skip:|nextOffset|take: 25[\s\S]*take: 25/);
});

test("unified cursor contract handles mixed same-date rows and an imbalanced source without skips", () => {
  const sourceRank = { invoice: 1, repairOrder: 0 };
  const records = [
    ...Array.from({ length: 31 }, (_, index) => ({ source: "invoice", id: `i-${String(index).padStart(2, "0")}`, serviceDate: index < 4 ? "2026-01-01" : `2025-12-${String(31 - index).padStart(2, "0")}` })),
    ...Array.from({ length: 4 }, (_, index) => ({ source: "repairOrder", id: `r-${index}`, serviceDate: "2026-01-01" })),
  ].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || sourceRank[b.source] - sourceRank[a.source] || b.id.localeCompare(a.id));
  const first = records.slice(0, 25);
  const second = records.slice(25, 50);
  assert.equal(first.length, 25);
  assert.equal(second.length, 10);
  assert.equal(new Set([...first, ...second].map((row) => `${row.source}:${row.id}`)).size, records.length);
  assert.equal(records.length > first.length, true);
  assert.equal(records.length > first.length + second.length, false);
  assert.deepEqual(records.filter((row) => row.serviceDate === "2026-01-01").map((row) => row.source), ["invoice", "invoice", "invoice", "invoice", "repairOrder", "repairOrder", "repairOrder", "repairOrder"]);
});

test("Load More uses source-aware keys and cannot collapse equal IDs or display numbers", () => {
  assert.match(drawer, /loadRepairOrderHistory\(currentRepairOrderId, nextCursor\)/);
  assert.match(drawer, /`\$\{row\.source\}:\$\{row\.id\}`/);
  assert.match(drawer, /!known\.has\(`\$\{row\.source\}:\$\{row\.id\}`\)/);
  assert.match(drawer, /nextCursor !== null/);
  assert.doesNotMatch(drawer, /known.*row\.number/);
});

test("verified VEETTIL fixture preserves all three legacy null-link invoices", () => {
  const current = { source: "repairOrder", id: "current-21748", number: "21748", customerId: "customer-veettil", vehicleId: "vehicle-acura" };
  const candidates = [
    { source: "invoice", id: "invoice-11726", number: "11726", serviceDate: "2013-05-26", total: "$65.09", repairOrderId: null, customerId: current.customerId, vehicleId: current.vehicleId },
    { source: "invoice", id: "invoice-10642", number: "10642", serviceDate: "2012-07-25", total: "$603.25", repairOrderId: null, customerId: current.customerId, vehicleId: current.vehicleId },
    { source: "invoice", id: "invoice-10429", number: "10429", serviceDate: "2012-06-03", total: "$126.78", repairOrderId: null, customerId: current.customerId, vehicleId: current.vehicleId },
  ];
  assert.deepEqual(candidates.map(({ number, total }) => [number, total]), [["11726", "$65.09"], ["10642", "$603.25"], ["10429", "$126.78"]]);
  assert.ok(candidates.every((row) => row.repairOrderId === null && row.customerId === current.customerId && row.vehicleId === current.vehicleId));
});

test("relationship fixture suppresses only linked RO and keeps equal unlinked display number", () => {
  const records = [
    { source: "invoice", id: "invoice-a", number: "42", repairOrderId: "ro-a" },
    { source: "repairOrder", id: "ro-a", number: "42" },
    { source: "repairOrder", id: "ro-b", number: "42" },
  ];
  const linked = new Set(records.filter((row) => row.source === "invoice" && row.repairOrderId).map((row) => row.repairOrderId));
  const visible = records.filter((row) => row.source === "invoice" || !linked.has(row.id));
  assert.deepEqual(visible.map((row) => row.id), ["invoice-a", "ro-b"]);
});

test("list includes both sources and all scan fields; invoices prevent empty state", () => {
  assert.match(loader, /source: "invoice"/);
  assert.match(loader, /source: "repairOrder"/);
  assert.match(drawer, /No previous Repair Orders were found for this customer and vehicle\./);
  for (const field of ["number", "status", "date", "odometer", "summary", "total"]) assert.match(drawer, new RegExp(`row\\.${field}`));
  assert.match(loader, /conciseSummary\(invoice, "invoice"\)/);
  assert.match(loader, /conciseSummary\(order, "repairOrder"\)/);
  assert.match(loader, /status: "completed"/);
  assert.match(drawer, /Mileage at service: \{row\.odometer \?\? "Not recorded"\}/);
});

test("history mileage uses service records, formats values, and never uses current Vehicle mileage", () => {
  assert.match(loader, /serviceOdometer\(invoice\.odometer, invoice\.repairOrder\?\.odometer\)/);
  assert.match(loader, /serviceOdometer\(order\.odometer\)/);
  assert.match(loader, /value\.toLocaleString\(\)/);
  assert.match(loader, /value > 0/);
  assert.doesNotMatch(loader, /invoice\.vehicle\?\.odometer|snapshotNumber\(invoice\.vehicleSnapshot, "odometer"/);
  assert.match(drawer, /Mileage at service/);
  assert.match(drawer, /Not recorded/);
});

test("Invoice mileage takes precedence over its linked Repair Order mileage", () => {
  assert.match(loader, /serviceOdometer\(invoice\.odometer, invoice\.repairOrder\?\.odometer\)/);
});

test("current Repair Order mileage is stored and copied into the completed Invoice", async () => {
  const createAction = await read("src/app/(app)/repair-orders/actions.ts");
  const finalization = await read("src/app/(app)/repair-orders/finalize-actions.ts");
  const newOrderForm = await read("src/components/new-repair-order-form.tsx");
  assert.match(newOrderForm, /Mileage at service/);
  assert.match(newOrderForm, /name="mileage" type="number" min="1"/);
  assert.match(createAction, /status: "draft",\s*odometer: mileage/);
  assert.match(finalization, /repairOrderNumber: true,\s*odometer: true/);
  assert.match(finalization, /invoiceDate: now,\s*odometer: order\.odometer/);
});

test("browser sends source and ID; unsupported and cross-scope details are rejected", () => {
  assert.match(drawer, /onSelect\(row\.source, row\.id\)/);
  assert.match(drawer, /loadRepairOrderHistoryDetail\(currentRepairOrderId, source, historicalId\)/);
  assert.match(actions, /getRepairOrderHistoryDetail\(currentRepairOrderId, source, historicalId\)/);
  assert.match(loader, /value === "invoice" \|\| value === "repairOrder"/);
  assert.match(loader, /if \(!isHistorySource\(source\)\) return null/);
  const invoiceDetail = loader.slice(loader.indexOf('if (source === "invoice")'), loader.indexOf("const order = await prisma.repairOrder.findFirst"));
  assert.match(invoiceDetail, /id: historicalId, shopId: scope\.shopId, customerId: scope\.customerId, vehicleId: scope\.vehicleId/);
  const repairOrderDetail = loader.slice(loader.indexOf("const order = await prisma.repairOrder.findFirst"));
  assert.match(repairOrderDetail, /id: historicalId, shopId: scope\.shopId, customerId: scope\.customerId, vehicleId: scope\.vehicleId/);
  assert.match(loader, /historicalId === scope\.currentRepairOrderId/);
});

test("Invoice and Repair Order detail both stay in drawer with work-only fields", () => {
  assert.match(drawer, /← Back to History/);
  assert.match(drawer, /HistoryLines title="Parts"/);
  assert.match(drawer, /HistoryLines title="Labor"/);
  assert.match(drawer, /Shop Supplies/);
  assert.match(drawer, /Stored Service Totals/);
  assert.match(loader, /vehicleSnapshot: true/);
  assert.match(loader, /odometer: true/);
  assert.match(loader, /repairOrder: \{ select: \{ odometer: true \} \}/);
  assert.match(loader, /partsTotal: true, laborTotal: true, subtotal: true, shopSuppliesAmount: true/);
  assert.doesNotMatch(drawer + loader, /accountsReceivable|paidTotal|paymentMethods|tender|balanceDue/);
});

test("drawer accessibility, form preservation, print, email, and calculations remain intact", () => {
  assert.match(drawer, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.key !== "Tab"/);
  assert.match(actionsUi, /historyButtonRef\.current\?\.focus\(\)/);
  assert.match(print, /getWebRepairOrderForCurrentShop/);
  assert.match(email, /RepairOrderDocumentPDF/);
  assert.match(concerns, /updateRepairOrderConcerns/);
  assert.doesNotMatch(loader + actions + drawer, /prisma\.(?:create|update|upsert|delete)|estimatedTotal\s*[+*/-]=/);
});
