-- Existing false values predate user-visible/calculated eligibility and therefore
-- represent the old implicit eligible behavior, not deliberate exclusions.
UPDATE "repair_order_labor"
SET "shop_supplies_eligible" = true
WHERE "shop_supplies_eligible" = false;

ALTER TABLE "repair_order_labor"
ALTER COLUMN "shop_supplies_eligible" SET DEFAULT true;

-- Canned-service eligibility was likewise not exposed or honored before this feature.
UPDATE "canned_services"
SET "shop_supplies_eligible" = true
WHERE "shop_supplies_eligible" = false;

ALTER TABLE "canned_services"
ALTER COLUMN "shop_supplies_eligible" SET DEFAULT true;

ALTER TABLE "invoice_labor"
ADD COLUMN "shop_supplies_eligible" BOOLEAN NOT NULL DEFAULT true;
