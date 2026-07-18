CREATE TABLE "marketing_settings" (
  "shop_id" UUID NOT NULL,
  "headline" TEXT,
  "subheadline" TEXT,
  "service_intro" TEXT,
  "about_title" TEXT,
  "about_body" TEXT,
  "contact_intro" TEXT,
  "hours_text" TEXT,
  "review_url" TEXT,
  CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("shop_id"),
  CONSTRAINT "marketing_settings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "marketing_pages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "shop_id" UUID NOT NULL, "slug" TEXT NOT NULL,
  "eyebrow" TEXT, "title" TEXT NOT NULL, "description" TEXT NOT NULL, "body" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "marketing_pages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_pages_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "marketing_pages_shop_id_slug_key" ON "marketing_pages"("shop_id", "slug");

CREATE TABLE "marketing_services" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "shop_id" UUID NOT NULL, "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL, "summary" TEXT NOT NULL, "detail" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "marketing_services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_services_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "marketing_services_shop_id_slug_key" ON "marketing_services"("shop_id", "slug");
CREATE INDEX "marketing_services_shop_id_active_sort_order_idx" ON "marketing_services"("shop_id", "active", "sort_order");

CREATE TABLE "marketing_coupons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "shop_id" UUID NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "terms" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "marketing_coupons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_coupons_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "marketing_coupons_shop_id_active_sort_order_idx" ON "marketing_coupons"("shop_id", "active", "sort_order");

CREATE TABLE "marketing_testimonials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "shop_id" UUID NOT NULL, "quote" TEXT NOT NULL, "attribution" TEXT,
  "rating" SMALLINT, "active" BOOLEAN NOT NULL DEFAULT true, "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "marketing_testimonials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_testimonials_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_testimonials_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5)
);
CREATE INDEX "marketing_testimonials_shop_id_active_sort_order_idx" ON "marketing_testimonials"("shop_id", "active", "sort_order");

CREATE TABLE "marketing_gallery_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "shop_id" UUID NOT NULL, "title" TEXT NOT NULL, "caption" TEXT,
  "image_url" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "marketing_gallery_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_gallery_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "marketing_gallery_items_shop_id_active_sort_order_idx" ON "marketing_gallery_items"("shop_id", "active", "sort_order");

ALTER TABLE "marketing_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_testimonials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_gallery_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "marketing_settings", "marketing_pages", "marketing_services", "marketing_coupons", "marketing_testimonials", "marketing_gallery_items" FROM anon, authenticated;
