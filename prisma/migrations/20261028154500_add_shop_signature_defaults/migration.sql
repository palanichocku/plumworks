CREATE TABLE IF NOT EXISTS "shop_signature_defaults" (
  "shop_id" UUID NOT NULL,
  "representative_name" TEXT NOT NULL,
  "signature_data" TEXT NOT NULL,
  "signature_sha256" TEXT NOT NULL,
  "updated_by" UUID,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_signature_defaults_pkey" PRIMARY KEY ("shop_id"),
  CONSTRAINT "shop_signature_defaults_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Seed the shop default from existing delivery evidence when available.
-- Prefer Subbu's signature from RO #21861, then his most recent shop-representative signature.
INSERT INTO "shop_signature_defaults" (
  "shop_id",
  "representative_name",
  "signature_data",
  "signature_sha256",
  "updated_by",
  "updated_at"
)
SELECT DISTINCT ON (ae."shop_id")
  ae."shop_id",
  COALESCE(NULLIF(BTRIM(s."default_authorized_representative"), ''), ae."authorizer_name", 'Subbu Veerappan'),
  se."signature_data",
  se."signature_sha256",
  ae."staff_user_id",
  ae."occurred_at"
FROM "authorization_events" ae
JOIN "document_revisions" dr
  ON dr."id" = ae."document_revision_id"
  AND dr."shop_id" = ae."shop_id"
JOIN "signature_evidence" se
  ON se."authorization_event_id" = ae."id"
  AND se."shop_id" = ae."shop_id"
JOIN "shops" s
  ON s."id" = ae."shop_id"
WHERE dr."document_type" = 'INVOICE'::"DocumentEvidenceType"
  AND ae."method" = 'IN_PERSON_SIGNATURE'::"AuthorizationMethod"
  AND ae."decision" = 'DELIVERY_ACKNOWLEDGED'::"AuthorizationDecision"
  AND ae."signature_role" = 'SHOP_REPRESENTATIVE'::"SignatureRole"
  AND LOWER(ae."authorizer_name") = LOWER('Subbu Veerappan')
ORDER BY
  ae."shop_id",
  CASE WHEN dr."snapshot" #>> '{invoice,number}' = '21861' THEN 0 ELSE 1 END,
  ae."occurred_at" DESC,
  ae."id" DESC
ON CONFLICT ("shop_id") DO NOTHING;
