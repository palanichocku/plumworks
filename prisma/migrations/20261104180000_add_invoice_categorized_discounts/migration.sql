-- Existing invoices retain NULL fields and historical proportional discount logic.
ALTER TABLE "invoices" ADD COLUMN "parts_discount_amount" DECIMAL(12,2), ADD COLUMN "labor_discount_amount" DECIMAL(12,2);
ALTER TABLE "invoices"
 ADD CONSTRAINT "invoice_discount_parts_nonnegative" CHECK (parts_discount_amount IS NULL OR parts_discount_amount >= 0),
 ADD CONSTRAINT "invoice_discount_labor_nonnegative" CHECK (labor_discount_amount IS NULL OR labor_discount_amount >= 0),
 ADD CONSTRAINT "invoice_discount_pair" CHECK ((parts_discount_amount IS NULL) = (labor_discount_amount IS NULL)),
 ADD CONSTRAINT "invoice_discount_sum" CHECK (parts_discount_amount IS NULL OR parts_discount_amount + labor_discount_amount = discount_amount);
