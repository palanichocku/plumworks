export type LeadNotificationSettings = {
  marketingLeadEmailNotificationsEnabled: boolean;
  marketingLeadNotifyEmail1: string | null;
  marketingLeadNotifyEmail2: string | null;
};

export function normalizeLeadNotificationEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid notification email address.");
  }
  return email;
}

export function leadNotificationRecipients(settings: LeadNotificationSettings, fallback?: string) {
  if (!settings.marketingLeadEmailNotificationsEnabled) return [];
  const configured = [settings.marketingLeadNotifyEmail1, settings.marketingLeadNotifyEmail2]
    .map((email) => email?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
  return [...new Set(configured.length ? configured : fallback?.trim() ? [fallback.trim().toLowerCase()] : [])];
}
