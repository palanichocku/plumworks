"use server";
import { revalidatePath } from "next/cache";
import { getLeadNotificationState, readAllLeadNotifications } from "@/lib/marketing-lead-notification-center";

export async function fetchLeadNotifications() { return getLeadNotificationState(); }
export async function markAllLeadNotificationsRead(asOf: string) {
  await readAllLeadNotifications(asOf);
  revalidatePath("/leads");
  revalidatePath("/leads/[id]", "page");
}
