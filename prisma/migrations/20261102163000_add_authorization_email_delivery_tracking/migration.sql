ALTER TABLE "authorization_requests"
  ADD COLUMN "email_provider_id" TEXT,
  ADD COLUMN "email_delivery_status" TEXT,
  ADD COLUMN "email_delivery_checked_at" TIMESTAMP(3);

ALTER TABLE "authorization_requests"
  ADD CONSTRAINT "authorization_requests_email_delivery_status_check"
  CHECK (
    "email_delivery_status" IS NULL OR
    "email_delivery_status" IN ('sent', 'delivered', 'delivery_delayed', 'bounced', 'suppressed', 'failed')
  );

CREATE INDEX "authorization_requests_email_provider_id_idx"
  ON "authorization_requests"("email_provider_id")
  WHERE "email_provider_id" IS NOT NULL;
