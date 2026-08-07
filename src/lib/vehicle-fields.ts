export const VEHICLE_ENGINE_MAX_LENGTH = 100;

export function vehicleEngineForStorage(value: FormDataEntryValue | null): string | null | undefined {
  const engine = String(value ?? "").trim();
  if (engine.length > VEHICLE_ENGINE_MAX_LENGTH) return undefined;
  return engine || null;
}
