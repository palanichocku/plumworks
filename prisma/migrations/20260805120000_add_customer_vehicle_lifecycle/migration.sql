ALTER TABLE "customers" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "customers_shop_id_archived_at_idx" ON "customers"("shop_id", "archived_at");
CREATE INDEX "vehicles_shop_id_archived_at_idx" ON "vehicles"("shop_id", "archived_at");

ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_customer_id_fkey";
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_legacy_aliases" DROP CONSTRAINT "customer_legacy_aliases_customer_id_fkey";
ALTER TABLE "customer_legacy_aliases" ADD CONSTRAINT "customer_legacy_aliases_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
