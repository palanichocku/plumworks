CREATE TABLE "shop_security_settings" (
  "shop_id" UUID PRIMARY KEY,
  "mfa_required" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "shop_security_settings_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE
);

ALTER TABLE "shop_security_settings" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "shop_security_settings" FROM anon;
REVOKE ALL ON TABLE "shop_security_settings" FROM authenticated;
