CREATE TABLE "customer_legacy_aliases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "alias_legacy_custno" TEXT NOT NULL,
  "source" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_legacy_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_legacy_aliases_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_legacy_aliases_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_legacy_aliases_shop_id_alias_legacy_custno_key"
  ON "customer_legacy_aliases"("shop_id", "alias_legacy_custno");

CREATE INDEX "customer_legacy_aliases_customer_id_idx"
  ON "customer_legacy_aliases"("customer_id");

CREATE INDEX "customer_legacy_aliases_shop_id_idx"
  ON "customer_legacy_aliases"("shop_id");

ALTER TABLE "customer_legacy_aliases" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "customer_legacy_aliases" FROM anon, authenticated;
