"use server";
import { revalidatePath } from "next/cache";
import { getLeadNotificationState, readLeadNotification, readAllLeadNotifications } from "@/lib/marketing-lead-notification-center";

export async function fetchLeadNotifications() { return getLeadNotificationState(); }
export async function markLeadNotificationRead(id: string) {
  const result = await readLeadNotification(id);
  revalidatePath("/leads");
  revalidatePath(result.href);
  return result;
}
export async function markAllLeadNotificationsRead(asOf: string) {
  await readAllLeadNotifications(asOf);
  revalidatePath("/leads");
  revalidatePath("/leads/[id]", "page");
}
