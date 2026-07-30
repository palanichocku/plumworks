const PHONE_CHARACTERS = /^[\d\s()+.-]*$/;

export function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizedNorthAmericanPhoneDigits(value: string) {
  if (!PHONE_CHARACTERS.test(value)) return null;

  const digits = phoneDigits(value);
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length > 10) return null;
  return digits;
}

export function formatPhoneDigits(digits: string) {
  const nationalDigits = digits.slice(0, 10);
  if (!nationalDigits) return "";
  if (nationalDigits.length < 3) return `(${nationalDigits}`;
  if (nationalDigits.length === 3) return `(${nationalDigits})`;
  if (nationalDigits.length <= 6) {
    return `(${nationalDigits.slice(0, 3)}) ${nationalDigits.slice(3)}`;
  }
  return `(${nationalDigits.slice(0, 3)}) ${nationalDigits.slice(3, 6)}-${nationalDigits.slice(6)}`;
}

export function formatPhoneInput(value: string) {
  let digits = phoneDigits(value);
  if (digits.length >= 11 && digits.startsWith("1")) digits = digits.slice(1);
  return formatPhoneDigits(digits);
}

export function isCompleteNorthAmericanPhone(value: string) {
  return normalizedNorthAmericanPhoneDigits(value)?.length === 10;
}

export function formatExistingCustomerPhone(value: string) {
  const digits = normalizedNorthAmericanPhoneDigits(value);
  return digits?.length === 10 ? formatPhoneDigits(digits) : value;
}

export function customerPhoneForStorage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = normalizedNorthAmericanPhoneDigits(trimmed);
  return digits?.length === 10 ? formatPhoneDigits(digits) : undefined;
}
