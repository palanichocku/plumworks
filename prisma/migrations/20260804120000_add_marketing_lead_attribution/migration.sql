ALTER TABLE "marketing_leads"
  ADD COLUMN "attribution_source" TEXT,
  ADD COLUMN "attribution_medium" TEXT,
  ADD COLUMN "attribution_campaign" TEXT,
  ADD COLUMN "attribution_term" TEXT,
  ADD COLUMN "attribution_content" TEXT,
  ADD COLUMN "google_click_id" TEXT,
  ADD COLUMN "facebook_click_id" TEXT,
  ADD COLUMN "microsoft_click_id" TEXT,
  ADD COLUMN "referrer" TEXT,
  ADD COLUMN "landing_path" TEXT,
  ADD COLUMN "submission_path" TEXT,
  ADD COLUMN "first_touch_at" TIMESTAMP(3);

CREATE INDEX "marketing_leads_shop_id_attribution_source_created_at_idx"
  ON "marketing_leads"("shop_id", "attribution_source", "created_at");
