-- Add a shop-scoped vendor directory and optional internal vendor provenance.
CREATE TABLE "vendors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "normalized_name" VARCHAR(150) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "repair_order_parts"
  ADD COLUMN "vendor_id" UUID,
  ADD COLUMN "vendor_name_snapshot" TEXT;

ALTER TABLE "invoice_parts"
  ADD COLUMN "vendor_name_snapshot" TEXT;

CREATE UNIQUE INDEX "vendors_shop_id_normalized_name_key"
  ON "vendors"("shop_id", "normalized_name");
CREATE INDEX "vendors_shop_id_name_idx" ON "vendors"("shop_id", "name");
CREATE INDEX "repair_order_parts_vendor_id_idx" ON "repair_order_parts"("vendor_id");

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_shop_id_fkey" FOREIGN KEY ("shop_id")
  REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "repair_order_parts"
  ADD CONSTRAINT "repair_order_parts_vendor_id_fkey" FOREIGN KEY ("vendor_id")
  REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "vendors" FROM anon, authenticated;
