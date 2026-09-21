-- Historical leads and non-form telemetry retain a null preference.
CREATE TYPE "MarketingLeadContactMethod" AS ENUM ('TEXT', 'PHONE_CALL', 'EMAIL');

ALTER TABLE "marketing_leads" ADD COLUMN "preferred_contact_method" "MarketingLeadContactMethod";
