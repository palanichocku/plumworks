-- Development feature: make remote authorization channel explicit.
ALTER TYPE "AuthorizationMethod" ADD VALUE IF NOT EXISTS 'SMS_LINK';

ALTER TABLE "authorization_requests"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "recipient_phone" TEXT,
  ADD COLUMN "sms_provider_id" TEXT,
  ADD COLUMN "sms_delivery_status" TEXT;

ALTER TABLE "authorization_requests"
  ADD CONSTRAINT "authorization_requests_channel_check" CHECK ("channel" IN ('EMAIL', 'SMS')),
  ADD CONSTRAINT "authorization_requests_sms_delivery_status_check"
    CHECK ("sms_delivery_status" IS NULL OR "sms_delivery_status" IN ('accepted', 'failed', 'delivered', 'undelivered'));

CREATE INDEX "authorization_requests_sms_provider_id_idx"
  ON "authorization_requests"("sms_provider_id")
  WHERE "sms_provider_id" IS NOT NULL;
