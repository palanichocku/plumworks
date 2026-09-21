ALTER TABLE "shops"
  ADD COLUMN "marketing_lead_in_app_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "marketing_lead_email_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "marketing_lead_notify_email_1" TEXT,
  ADD COLUMN "marketing_lead_notify_email_2" TEXT;

CREATE UNIQUE INDEX "marketing_leads_shop_id_id_key" ON "marketing_leads"("shop_id", "id");

-- No historical backfill: notifications are created only with new form submissions.
CREATE TABLE "marketing_lead_notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "marketing_lead_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_lead_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_lead_notifications_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_lead_notifications_shop_id_marketing_lead_id_fkey" FOREIGN KEY ("shop_id", "marketing_lead_id") REFERENCES "marketing_leads"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "marketing_lead_notifications_marketing_lead_id_key" ON "marketing_lead_notifications"("marketing_lead_id");
CREATE UNIQUE INDEX "marketing_lead_notifications_shop_id_id_key" ON "marketing_lead_notifications"("shop_id", "id");
CREATE UNIQUE INDEX "marketing_lead_notifications_shop_id_marketing_lead_id_key" ON "marketing_lead_notifications"("shop_id", "marketing_lead_id");
CREATE INDEX "marketing_lead_notifications_shop_id_created_at_id_idx" ON "marketing_lead_notifications"("shop_id", "created_at", "id");

CREATE TABLE "marketing_lead_notification_reads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_lead_notification_reads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_lead_notification_reads_shop_id_notification_id_fkey" FOREIGN KEY ("shop_id", "notification_id") REFERENCES "marketing_lead_notifications"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_lead_notification_reads_shop_id_user_id_fkey" FOREIGN KEY ("shop_id", "user_id") REFERENCES "shop_memberships"("shop_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "marketing_lead_notification_reads_notification_id_user_id_key" ON "marketing_lead_notification_reads"("notification_id", "user_id");
CREATE INDEX "marketing_lead_notification_reads_shop_id_user_id_idx" ON "marketing_lead_notification_reads"("shop_id", "user_id");

ALTER TABLE "marketing_lead_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_lead_notification_reads" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "marketing_lead_notifications", "marketing_lead_notification_reads" FROM anon, authenticated;
