ALTER TABLE "repair_order_labor"
ADD COLUMN "complimentary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "invoice_labor"
ADD COLUMN "complimentary" BOOLEAN NOT NULL DEFAULT false;
