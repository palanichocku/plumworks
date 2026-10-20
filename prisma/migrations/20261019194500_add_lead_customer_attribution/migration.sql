-- Link website leads to the customer they produce and retain the original customer acquisition source.
ALTER TABLE "customers"
ADD COLUMN "acquisition_source" TEXT;

ALTER TABLE "marketing_leads"
ADD COLUMN "customer_id" UUID,
ADD COLUMN "converted_at" TIMESTAMP(3);

ALTER TABLE "marketing_leads"
ADD CONSTRAINT "marketing_leads_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "marketing_leads_shop_id_customer_id_idx"
ON "marketing_leads"("shop_id", "customer_id");

CREATE INDEX "customers_shop_id_acquisition_source_idx"
ON "customers"("shop_id", "acquisition_source");
