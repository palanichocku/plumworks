-- CreateTable
CREATE TABLE "raw_legacy_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_id" UUID NOT NULL,
    "legacy_import_run_id" UUID NOT NULL,
    "legacy_custno" TEXT,
    "raw_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_legacy_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_legacy_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_id" UUID NOT NULL,
    "legacy_import_run_id" UUID NOT NULL,
    "legacy_custno" TEXT,
    "legacy_carno" TEXT,
    "raw_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_legacy_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raw_legacy_customers_shop_id_legacy_custno_idx" ON "raw_legacy_customers"("shop_id", "legacy_custno");

-- CreateIndex
CREATE INDEX "raw_legacy_customers_legacy_import_run_id_idx" ON "raw_legacy_customers"("legacy_import_run_id");

-- CreateIndex
CREATE INDEX "raw_legacy_vehicles_shop_id_legacy_custno_idx" ON "raw_legacy_vehicles"("shop_id", "legacy_custno");

-- CreateIndex
CREATE INDEX "raw_legacy_vehicles_shop_id_legacy_carno_idx" ON "raw_legacy_vehicles"("shop_id", "legacy_carno");

-- CreateIndex
CREATE INDEX "raw_legacy_vehicles_legacy_import_run_id_idx" ON "raw_legacy_vehicles"("legacy_import_run_id");

-- AddForeignKey
ALTER TABLE "raw_legacy_customers" ADD CONSTRAINT "raw_legacy_customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_legacy_customers" ADD CONSTRAINT "raw_legacy_customers_legacy_import_run_id_fkey" FOREIGN KEY ("legacy_import_run_id") REFERENCES "legacy_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_legacy_vehicles" ADD CONSTRAINT "raw_legacy_vehicles_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_legacy_vehicles" ADD CONSTRAINT "raw_legacy_vehicles_legacy_import_run_id_fkey" FOREIGN KEY ("legacy_import_run_id") REFERENCES "legacy_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
