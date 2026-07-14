export function formatMoney(value: { toString(): string } | null | undefined) {
  const amount = Number(value?.toString() ?? 0);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(amount) ? amount : 0);
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
