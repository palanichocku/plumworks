"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { decidePublicRepairOrderAuthorization } from "@/lib/authorization/remote-repair-order-authorization";

function redirectTarget(token: string, key: string, value: string) {
  return `/authorize/repair-order/${encodeURIComponent(token)}?${key}=${encodeURIComponent(value)}`;
}

export async function submitRepairOrderAuthorization(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const decisionValue = String(formData.get("decision") ?? "");
  const authorizerName = String(formData.get("authorizerName") ?? "");
  const consentAccepted = formData.get("consent") === "yes";
  if (decisionValue !== "APPROVED" && decisionValue !== "DECLINED") redirect(redirectTarget(token, "error", "decision"));

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip");
  const userAgent = requestHeaders.get("user-agent");

  const result = await decidePublicRepairOrderAuthorization({
    token,
    decision: decisionValue,
    authorizerName,
    consentAccepted,
    ipAddress,
    userAgent,
  });

  if (!result.ok) redirect(redirectTarget(token, "error", result.code));
  redirect(redirectTarget(token, "completed", result.status.toLowerCase()));
}
