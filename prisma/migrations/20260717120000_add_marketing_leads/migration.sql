CREATE TYPE "MarketingLeadSource" AS ENUM ('CONTACT', 'APPOINTMENT', 'DROP_OFF');
CREATE TYPE "MarketingLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'SCHEDULED', 'CONVERTED', 'CLOSED');

CREATE TABLE "marketing_leads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "source" "MarketingLeadSource" NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "vehicle_year" INTEGER,
  "vehicle_make" TEXT,
  "vehicle_model" TEXT,
  "requested_service" TEXT,
  "preferred_date" DATE,
  "message" TEXT,
  "status" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_leads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_leads_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "marketing_leads_shop_id_status_created_at_idx"
  ON "marketing_leads"("shop_id", "status", "created_at");

ALTER TABLE "marketing_leads" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "marketing_leads" FROM anon, authenticated;
