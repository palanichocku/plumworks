-- Add independent customer complaint and service recommendation notes.
-- Existing repair orders remain valid and receive NULL for both columns.
ALTER TABLE "repair_orders"
ADD COLUMN "customer_complaint" TEXT,
ADD COLUMN "recommendation" TEXT;
