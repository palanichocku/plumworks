/** Format authorization instants in the shop's local timezone, not the server's UTC timezone. */
export const AUTHORIZATION_TIME_ZONE = "America/Detroit";
export function formatAuthorizationDateTime(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: AUTHORIZATION_TIME_ZONE,
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZoneName: "short",
  }).format(date);
}
