CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "user_id" UUID,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "audit_logs_shop_id_created_at_idx" ON "audit_logs"("shop_id", "created_at");
CREATE INDEX "audit_logs_shop_id_entity_type_entity_id_idx" ON "audit_logs"("shop_id", "entity_type", "entity_id");
