import type { AssetContext, DisplayField } from "../../domain/assets.ts";

export type AutomotiveAssetSource = Readonly<{
  id: string;
  customerId: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  engine?: string | null;
  vin?: string | null;
  licensePlate?: string | null;
  odometer?: number | null;
  archivedAt?: Date | null;
  customerArchivedAt?: Date | null;
}>;

function text(value: string | null | undefined) {
  return value?.trim() || null;
}

export function automotiveAssetDisplayLabel(asset: Pick<AutomotiveAssetSource, "year" | "make" | "model">) {
  return [asset.year, text(asset.make), text(asset.model)].filter((value) => value !== null && value !== undefined).join(" ") || "Vehicle details unavailable";
}

export function toAutomotiveAssetContext(asset: AutomotiveAssetSource): AssetContext {
  const details: DisplayField[] = [];
  const values: Array<[string, string | number | null | undefined]> = [
    ["Year", asset.year],
    ["Make", text(asset.make)],
    ["Model", text(asset.model)],
    ["Engine", text(asset.engine)],
    ["VIN", text(asset.vin)],
    ["License plate", text(asset.licensePlate)],
    ["Odometer", asset.odometer],
  ];
  for (const [label, value] of values) {
    if (value !== null && value !== undefined && value !== "") details.push({ label, value: String(value) });
  }
  return {
    id: asset.id,
    customerId: asset.customerId,
    displayLabel: automotiveAssetDisplayLabel(asset),
    secondaryLabel: text(asset.licensePlate) ?? text(asset.vin),
    archived: Boolean(asset.archivedAt || asset.customerArchivedAt),
    details,
  };
}
