CREATE TABLE "repair_order_line_positions" (
  "shop_id" UUID NOT NULL,
  "repair_order_id" UUID NOT NULL,
  "line_type" TEXT NOT NULL,
  "legacy_line_key" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "repair_order_line_positions_line_type_check" CHECK ("line_type" IN ('part', 'labor')),
  CONSTRAINT "repair_order_line_positions_pkey" PRIMARY KEY ("shop_id", "line_type", "legacy_line_key"),
  CONSTRAINT "repair_order_line_positions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "repair_order_line_positions_repair_order_id_fkey" FOREIGN KEY ("repair_order_id") REFERENCES "repair_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "repair_order_line_positions_order_idx"
  ON "repair_order_line_positions"("shop_id", "repair_order_id", "line_type", "sort_order");

INSERT INTO "repair_order_line_positions" ("shop_id", "repair_order_id", "line_type", "legacy_line_key", "sort_order")
SELECT "shop_id", "repair_order_id", 'part', "legacy_line_key",
       ROW_NUMBER() OVER (PARTITION BY "shop_id", "repair_order_id" ORDER BY "created_at", "id") - 1
FROM "repair_order_parts"
ON CONFLICT DO NOTHING;

INSERT INTO "repair_order_line_positions" ("shop_id", "repair_order_id", "line_type", "legacy_line_key", "sort_order")
SELECT "shop_id", "repair_order_id", 'labor', "legacy_line_key",
       ROW_NUMBER() OVER (PARTITION BY "shop_id", "repair_order_id" ORDER BY "created_at", "id") - 1
FROM "repair_order_labor"
WHERE "complimentary" = FALSE
ON CONFLICT DO NOTHING;
