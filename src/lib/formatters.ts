export function formatMoney(value: { toString(): string } | null | undefined) {
  const source = value?.toString().trim() ?? "0";
  const match = source.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return "$0.00";
  const [, sign, whole, fraction = ""] = match;
  const padded = fraction.padEnd(3, "0");
  const hundred = BigInt(100);
  let absoluteCents = BigInt(whole) * hundred + BigInt(padded.slice(0, 2));
  if (padded[2] >= "5") absoluteCents += BigInt(1);
  const negative = sign === "-" && absoluteCents !== BigInt(0);
  const dollars = (absoluteCents / hundred).toLocaleString("en-US");
  const cents = String(absoluteCents % hundred).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${cents}`;
}

export function formatDate(value: Date | null | undefined) {
  if (!value) return "Date not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

const laborTextFields = [
  "description",
  "name",
  "label",
  "text",
  "note",
  "jobDescription",
  "job_description",
] as const;

export function formatLaborDescription(
  value: unknown,
  fallback = "Labor description unavailable",
) {
  if (typeof value === "string") {
    const text = value.trim();
    return text && text !== "[object Object]" ? text : fallback;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  for (const field of laborTextFields) {
    const candidate = record[field];
    if (typeof candidate === "string") {
      const text = candidate.trim();
      if (text && text !== "[object Object]") return text;
    }
  }

  return fallback;
}
