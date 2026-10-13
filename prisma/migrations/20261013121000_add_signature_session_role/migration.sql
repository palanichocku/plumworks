CREATE TYPE "SignatureRole" AS ENUM ('CUSTOMER', 'SHOP_REPRESENTATIVE');

ALTER TABLE "authorization_events"
ADD COLUMN "signature_role" "SignatureRole",
ADD COLUMN "signature_session_id" UUID;

CREATE INDEX "authorization_events_shop_id_signature_session_id_idx"
ON "authorization_events"("shop_id", "signature_session_id");

CREATE UNIQUE INDEX "authorization_events_signature_session_role_key"
ON "authorization_events"("signature_session_id", "signature_role")
WHERE "signature_session_id" IS NOT NULL AND "signature_role" IS NOT NULL;
