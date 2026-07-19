CREATE TYPE "LegacyChargeSourceBucket" AS ENUM ('TAX3', 'TAX4', 'TAX5', 'TAX6');

ALTER TABLE "shops"
  ADD COLUMN "shop_supplies_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shop_supplies_rate" DECIMAL(7,6) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_cap" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_taxable" BOOLEAN NOT NULL DEFAULT true;

-- Eligibility is deliberately disabled for existing definitions and lines until
-- repair-order calculation behavior is implemented in a later phase.
ALTER TABLE "canned_services"
  ADD COLUMN "shop_supplies_eligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "repair_order_labor"
  ADD COLUMN "shop_supplies_eligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "repair_orders"
  ADD COLUMN "shop_supplies_enabled_snapshot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shop_supplies_rate_snapshot" DECIMAL(7,6) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_cap_snapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_taxable_snapshot" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "shop_supplies_eligible_labor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_calculated_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_override_amount" DECIMAL(12,2),
  ADD COLUMN "shop_supplies_override_reason" TEXT,
  ADD COLUMN "shop_supplies_overridden_by_user_id" UUID,
  ADD COLUMN "shop_supplies_overridden_at" TIMESTAMP(3);

ALTER TABLE "invoices"
  ADD COLUMN "shop_supplies_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shop_supplies_enabled_snapshot" BOOLEAN,
  ADD COLUMN "shop_supplies_rate_snapshot" DECIMAL(7,6),
  ADD COLUMN "shop_supplies_cap_snapshot" DECIMAL(12,2),
  ADD COLUMN "shop_supplies_taxable_snapshot" BOOLEAN,
  ADD COLUMN "shop_supplies_eligible_labor_total" DECIMAL(12,2),
  ADD COLUMN "shop_supplies_calculated_amount" DECIMAL(12,2),
  ADD COLUMN "shop_supplies_was_overridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shop_supplies_override_reason" TEXT,
  ADD COLUMN "shop_supplies_overridden_by_user_id" UUID,
  ADD COLUMN "shop_supplies_overridden_at" TIMESTAMP(3);

CREATE TABLE "invoice_legacy_charges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoice_id" UUID NOT NULL,
  "source_bucket" "LegacyChargeSourceBucket" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "source_label" TEXT,
  "taxable" BOOLEAN,
  "legacy_source_table" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_legacy_charges_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "shops" ADD CONSTRAINT "shops_shop_supplies_nonnegative"
  CHECK ("shop_supplies_rate" >= 0 AND "shop_supplies_cap" >= 0);

ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_shop_supplies_nonnegative"
  CHECK (
    "shop_supplies_rate_snapshot" >= 0
    AND "shop_supplies_cap_snapshot" >= 0
    AND "shop_supplies_eligible_labor_total" >= 0
    AND "shop_supplies_calculated_amount" >= 0
    AND "shop_supplies_amount" >= 0
    AND ("shop_supplies_override_amount" IS NULL OR "shop_supplies_override_amount" >= 0)
  );

ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_shop_supplies_override_reason"
  CHECK (
    "shop_supplies_override_amount" IS NULL
    OR NULLIF(BTRIM("shop_supplies_override_reason"), '') IS NOT NULL
  );

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shop_supplies_nonnegative"
  CHECK (
    "shop_supplies_amount" >= 0
    AND ("shop_supplies_rate_snapshot" IS NULL OR "shop_supplies_rate_snapshot" >= 0)
    AND ("shop_supplies_cap_snapshot" IS NULL OR "shop_supplies_cap_snapshot" >= 0)
    AND ("shop_supplies_eligible_labor_total" IS NULL OR "shop_supplies_eligible_labor_total" >= 0)
    AND ("shop_supplies_calculated_amount" IS NULL OR "shop_supplies_calculated_amount" >= 0)
  );

ALTER TABLE "invoice_legacy_charges" ADD CONSTRAINT "invoice_legacy_charges_amount_nonnegative"
  CHECK ("amount" >= 0);

CREATE UNIQUE INDEX "invoice_legacy_charges_invoice_id_source_bucket_key"
  ON "invoice_legacy_charges"("invoice_id", "source_bucket");

CREATE INDEX "invoice_legacy_charges_invoice_id_idx"
  ON "invoice_legacy_charges"("invoice_id");

ALTER TABLE "invoice_legacy_charges"
  ADD CONSTRAINT "invoice_legacy_charges_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
