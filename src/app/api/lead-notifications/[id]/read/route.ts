import { revalidatePath } from "next/cache";
import { readLeadNotification } from "@/lib/marketing-lead-notification-center";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const metadata = { event: "lead_notification_read", notificationId: /^[0-9a-f-]{36}$/i.test(id) ? id : undefined };
  const origin = request.headers.get("origin");
  // Next may expose an internal URL hostname; Host is the browser-facing authority.
  const publicUrl = new URL(request.url);
  publicUrl.host = request.headers.get("host") ?? publicUrl.host;
  if ((origin && origin !== publicUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    console.error({ ...metadata, result: "failed" });
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  try {
    const { href } = await readLeadNotification(id);
    console.info({ ...metadata, result: "persisted" });
    revalidatePath("/leads");
    revalidatePath(href);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error({ ...metadata, result: "failed" });
    const message = error instanceof Error ? error.message : "";
    const status = message === "Sign in with an active shop membership." ? 401 : message === "Notification not found." ? 404 : 500;
    return Response.json({ error: "Could not mark notification read." }, { status });
  }
}
