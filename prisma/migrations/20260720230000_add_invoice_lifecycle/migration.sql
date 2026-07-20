ALTER TABLE "invoices"
  ADD COLUMN "closed_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "closed_by_user_id" UUID,
  ADD COLUMN "customer_complaint" TEXT,
  ADD COLUMN "recommendation" TEXT;
