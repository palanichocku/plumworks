-- Add payer identity without changing any payment amount or Invoice/AR financial value.
CREATE TYPE "PaymentPayerType" AS ENUM ('CUSTOMER', 'INSURANCE', 'WARRANTY', 'OTHER');

ALTER TABLE "payments"
ADD COLUMN "payer_type" "PaymentPayerType" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN "note" TEXT;

-- Existing rows predate payer capture, so their payer cannot be inferred truthfully.
UPDATE "payments"
SET "payer_type" = 'OTHER';
