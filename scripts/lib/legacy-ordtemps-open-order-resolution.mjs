import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { evidenceHash } from "./legacy-snapshot-evidence.mjs";
import { readRecoveryEvidenceDbf } from "./legacy-customer-recovery-proposal.mjs";
import { readLegacyOpenOrderHeaders } from "./legacy-open-order-header.mjs";
import { readActiveDbfRows } from "./legacy-open-order-source.mjs";
import { finalizedCollisionEvidence } from "./legacy-final-cutover-adjudication.mjs";

export const ORDTEMPS_RESOLUTION_VERSION = 1;
export const ORDTEMPS_RESOLUTION_TYPE = "snapshot-bound-ordtemps-active-ro-resolution";
export const ORDTEMPS_RESOLUTION_FILES = Object.freeze([
  "Cust.DBF", "vehicles.DBF", "orders.DBF", "LABORorder.DBF", "ordtemps.DBF", "ordtemps.FPT",
  "FINAL.DBF", "laborfinal.DBF", "ar.DBF", "finalsold.DBF",
]);

const text = (row, field) => row?.rawData?.[field] == null ? null : String(row.rawData[field]).trim() || null;
const exact = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validateOrdtempsResolution({ artifact, artifactSha256, snapshotManifest, snapshotManifestSha256, source, evidence }) {
  const issues = [];
  const fail = (code) => issues.push({ code });
  if (artifact?.formatVersion !== ORDTEMPS_RESOLUTION_VERSION || artifact?.artifactType !== ORDTEMPS_RESOLUTION_TYPE) fail("invalid-ordtemps-resolution-format");
  if (artifact?.approval?.approved !== true || !artifact?.approval?.reviewedBy || !artifact?.approval?.reviewedAt || !artifact?.approval?.reason) fail("unapproved-ordtemps-resolution");
  const binding = artifact?.snapshot;
  if (binding?.snapshotDate !== snapshotManifest.snapshotDate) fail("ordtemps-resolution-snapshot-date-mismatch");
  if (binding?.zipSha256 !== snapshotManifest.zipSha256) fail("ordtemps-resolution-zip-mismatch");
  if (binding?.snapshotManifestSha256 !== snapshotManifestSha256) fail("ordtemps-resolution-manifest-mismatch");
  if (binding?.combinedSourceFingerprint !== source.fingerprint) fail("ordtemps-resolution-source-fingerprint-mismatch");
  if (!exact(binding?.sourceHashes, source.fingerprints)) fail("ordtemps-resolution-source-hash-mismatch");
  const decision = artifact?.decisions?.length === 1 ? artifact.decisions[0] : null;
  if (!decision || decision.action !== "operationalize-reviewed-ordtemps-open-repair-order") fail("invalid-ordtemps-resolution-decision");
  if (decision && !exact(decision.evidence, evidence)) fail("ordtemps-resolution-evidence-mismatch");
  if (decision && (decision.resolved?.roNumber !== 21775 || decision.resolved?.customerLegacyId !== "87612072" || decision.resolved?.vehicleLegacyId !== "87612073" || decision.resolved?.roDate !== "2026-08-29" || decision.resolved?.mileage !== 91705 || decision.resolved?.status !== "open" || decision.resolved?.partsCount !== 0 || decision.resolved?.laborCount !== 0)) fail("invalid-ordtemps-resolved-values");
  return { issues, decision, artifactSha256 };
}

export async function loadOrdtempsResolutionEvidence(source, roNumber) {
  const [ordDbf, ordMemo, partFile, laborFile, customerFile, vehicleFile, final, laborFinal, ar, finalSold] = await Promise.all([
    readFile(source.files["ordtemps.DBF"]), readFile(source.files["ordtemps.FPT"]),
    readFile(source.files["orders.DBF"]), readFile(source.files["LABORorder.DBF"]),
    readFile(source.files["Cust.DBF"]), readFile(source.files["vehicles.DBF"]),
    readFile(source.files["FINAL.DBF"]).then(readActiveDbfRows), readFile(source.files["laborfinal.DBF"]).then(readActiveDbfRows),
    readFile(source.files["ar.DBF"]).then(readActiveDbfRows), readFile(source.files["finalsold.DBF"]).then(readActiveDbfRows),
  ]);
  const ro = String(roNumber);
  const headers = readLegacyOpenOrderHeaders(ordDbf, ordMemo, true).filter((row) => row.legacyRoNo === ro);
  const parts = readRecoveryEvidenceDbf(partFile, "rawLegacyOrderPart");
  const labor = readRecoveryEvidenceDbf(laborFile, "rawLegacyOrderLabor");
  const customers = readRecoveryEvidenceDbf(customerFile, "rawLegacyCustomer");
  const vehicles = readRecoveryEvidenceDbf(vehicleFile, "rawLegacyVehicle");
  const matchesRo = (row) => text(row, "RO_NO") === ro;
  const structural = [...parts.filter((row) => row.deleted && matchesRo(row)).map((row) => ({ sourceTable: "orders.DBF", stableRowKey: row.stableRowKey, evidenceSha256: row.evidenceSha256, deleted: true })), ...labor.filter((row) => row.deleted && matchesRo(row)).map((row) => ({ sourceTable: "LABORorder.DBF", stableRowKey: row.stableRowKey, evidenceSha256: row.evidenceSha256, deleted: true }))];
  const activeParts = parts.filter((row) => !row.deleted && matchesRo(row));
  const activeLabor = labor.filter((row) => !row.deleted && matchesRo(row));
  const customer = customers.filter((row) => !row.deleted && text(row, "CUSTNO") === "87612072");
  const vehicle = vehicles.filter((row) => !row.deleted && text(row, "CARNO") === "87612073" && text(row, "CUSTNO") === "87612072");
  const wrap = (rows) => rows.map((rawData) => ({ rawData }));
  const collision = finalizedCollisionEvidence(ro, { "FINAL.DBF": wrap(final), "laborfinal.DBF": wrap(laborFinal), "ar.DBF": wrap(ar), "finalsold.DBF": wrap(finalSold) });
  if (headers.length !== 1 || customer.length !== 1 || vehicle.length !== 1 || activeParts.length || activeLabor.length || structural.length !== 3 || Object.values(collision.sourceRows).some((rows) => rows.length)) throw new Error("RO 21775 source evidence is no longer exact and unambiguous.");
  const header = headers[0];
  if (header.legacyCustno !== "87612072" || header.legacyCarno !== "87612073" || text(header, "RO_DATE") !== "20260829" || text(header, "ODOMETER") !== "91705") throw new Error("RO 21775 ordtemps identity/date/mileage changed.");
  return {
    roNumber: roNumber,
    ordtempsHeader: { sourceTable: "ordtemps.DBF", physicalRecordNumber: header.physicalRecordNumber, stableRowKey: header.legacyRowKey, evidenceSha256: evidenceHash(header.rawData), deleted: false },
    structuralRows: structural.sort((a, b) => a.stableRowKey.localeCompare(b.stableRowKey)),
    customer: { legacyCustomerId: "87612072", exactName: text(customer[0], "CUSTOMER"), evidenceSha256: customer[0].evidenceSha256 },
    vehicle: { legacyVehicleId: "87612073", customerLegacyId: "87612072", year: text(vehicle[0], "YEAR"), make: text(vehicle[0], "MAKE"), model: text(vehicle[0], "MODEL"), evidenceSha256: vehicle[0].evidenceSha256 },
    sourceValues: { roDate: "2026-08-29", mileage: 91705, technician: text(header, "TECH"), activeParts: 0, activeLabor: 0 },
    finalizedCollision: collision,
  };
}

export function artifactSha256(bytes) { return sha256(bytes); }
