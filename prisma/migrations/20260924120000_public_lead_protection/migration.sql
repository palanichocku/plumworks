-- Additive only: historical marketing_leads and their messages are untouched.
CREATE TABLE "public_lead_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "ip_hash" CHAR(64) NOT NULL,
  "email_hash" CHAR(64) NOT NULL,
  "phone_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_lead_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_lead_submissions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "public_lead_submissions_shop_id_fingerprint_created_at_idx" ON "public_lead_submissions"("shop_id", "fingerprint", "created_at");
CREATE INDEX "public_lead_submissions_shop_id_ip_hash_created_at_idx" ON "public_lead_submissions"("shop_id", "ip_hash", "created_at");
CREATE INDEX "public_lead_submissions_shop_id_email_hash_created_at_idx" ON "public_lead_submissions"("shop_id", "email_hash", "created_at");
CREATE INDEX "public_lead_submissions_shop_id_phone_hash_created_at_idx" ON "public_lead_submissions"("shop_id", "phone_hash", "created_at");
CREATE INDEX "public_lead_submissions_shop_id_created_at_idx" ON "public_lead_submissions"("shop_id", "created_at");
ALTER TABLE "public_lead_submissions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "public_lead_submissions" FROM anon, authenticated;
