import "server-only";

import { normalizeUsSmsPhone } from "./phone";

/**
 * Development-only SMS recipient allowlist.
 * Exactly one or two distinct, valid US/Canada E.164 numbers are permitted.
 * Invalid, empty, duplicated, or larger lists fail closed.
 */
export function getDevelopmentSmsAllowedRecipients(): string[] {
  const raw = process.env.SMS_DEV_ALLOWED_TO?.trim() ?? "";
  if (!raw) return [];
  const items = raw.split(",").map(v => v.trim());
  if (items.length < 1 || items.length > 2 || items.some(v => !v)) return [];
  const parsed = items.map(normalizeUsSmsPhone);
  if (parsed.some(v => !v) || new Set(parsed).size !== parsed.length) return [];
  return parsed as string[];
}

export function isDevelopmentSmsRecipientAllowed(phone: string): boolean {
  const normalized = normalizeUsSmsPhone(phone);
  return Boolean(normalized && getDevelopmentSmsAllowedRecipients().includes(normalized));
}
