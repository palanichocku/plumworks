const auditLogDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Detroit",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export function formatAuditLogTimestamp(value: Date) {
  return auditLogDateTimeFormatter.format(value);
}
