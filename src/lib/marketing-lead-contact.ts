import type { MarketingLeadContactMethod } from "@/generated/prisma/client";

export const leadContactMethodLabels: Record<MarketingLeadContactMethod, string> = {
  TEXT: "Text",
  PHONE_CALL: "Phone Call",
  EMAIL: "Email",
};

export function parseLeadContactMethod(value: unknown): MarketingLeadContactMethod | null {
  return typeof value === "string" && Object.hasOwn(leadContactMethodLabels, value)
    ? value as MarketingLeadContactMethod
    : null;
}
