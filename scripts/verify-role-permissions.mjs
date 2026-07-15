import { readFile } from "node:fs/promises";

const matrix = JSON.parse(await readFile("src/lib/permission-matrix.json", "utf8"));
const roles = ["OWNER", "ADMIN", "STAFF"];
const permissions = [
  "view_dashboard", "view_search", "view_reports", "edit_customer_vehicle",
  "create_repair_order", "edit_draft_repair_order", "delete_draft_repair_order",
  "finalize_repair_order", "record_payment", "edit_shop_settings",
  "manage_canned_services", "view_audit_log", "manage_staff",
];
const staffOperational = [
  "view_dashboard", "view_search", "edit_customer_vehicle", "create_repair_order",
  "edit_draft_repair_order", "finalize_repair_order", "record_payment",
];
const staffRestricted = [
  "view_reports", "delete_draft_repair_order", "edit_shop_settings",
  "manage_canned_services", "view_audit_log", "manage_staff",
];

const allowed = roles.flatMap((role) => permissions.map((permission) => matrix[role].includes(permission))).filter(Boolean).length;
const blocked = roles.length * permissions.length - allowed;
const ownerAdminComplete = ["OWNER", "ADMIN"].every((role) => permissions.every((permission) => matrix[role].includes(permission)));
const staffAllowed = staffOperational.filter((permission) => matrix.STAFF.includes(permission)).length;
const staffBlocked = staffRestricted.filter((permission) => !matrix.STAFF.includes(permission)).length;

console.log(`allowed role-permission combinations: ${allowed}`);
console.log(`blocked role-permission combinations: ${blocked}`);
console.log(`OWNER/ADMIN complete permission sets: ${Number(ownerAdminComplete)}`);
console.log(`STAFF operational permissions allowed: ${staffAllowed}`);
console.log(`STAFF sensitive permissions blocked: ${staffBlocked}`);
