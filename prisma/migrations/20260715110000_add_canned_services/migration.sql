CREATE TABLE "canned_services" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "default_hours" DECIMAL(8,2) NOT NULL DEFAULT 1,
  "default_labor_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canned_services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canned_services_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "canned_services_shop_id_name_key" ON "canned_services"("shop_id", "name");
CREATE INDEX "canned_services_shop_id_active_idx" ON "canned_services"("shop_id", "active");
