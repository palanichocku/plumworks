export const MAX_INTERNAL_NOTES_LENGTH = 5_000;

export function normalizeInternalNotes(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  if (raw.length > MAX_INTERNAL_NOTES_LENGTH) return { error: `Notes must be ${MAX_INTERNAL_NOTES_LENGTH.toLocaleString()} characters or fewer.` } as const;
  return { notes: raw.trim() || null } as const;
}

export function canEditInternalNotes(role: string | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}
