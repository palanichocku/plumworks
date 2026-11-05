/**
 * Strict US/Canada NANP normalization for the initial PlumWorks SMS rollout.
 * Accepts a 10-digit local number, +1 number, or common punctuation.
 * Rejects extensions, alphabetic characters, and other country codes.
 * Later internationalization must use a vetted numbering library.
 */
export function normalizeUsSmsPhone(input: string): string | null {
  const value = input.trim();
  if (!value || !/^[+()0-9.\s-]+$/.test(value)) return null;
  if (value.includes("+") && (!value.startsWith("+") || value.indexOf("+", 1) >= 0)) return null;
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  if (value.startsWith("+") && !digits.startsWith("1")) return null;
  return `+1${ten}`;
}

/** Human-friendly display, while sending always uses E.164. */
export function formatUsSmsPhone(input: string): string {
  const normalized = normalizeUsSmsPhone(input);
  if (!normalized) return input;
  return `(${normalized.slice(2, 5)}) ${normalized.slice(5, 8)}-${normalized.slice(8)}`;
}
