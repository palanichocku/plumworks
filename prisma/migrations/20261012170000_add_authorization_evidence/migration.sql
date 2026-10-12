CREATE TYPE "DocumentEvidenceType" AS ENUM ('REPAIR_ORDER', 'INVOICE');
CREATE TYPE "AuthorizationMethod" AS ENUM ('PHONE', 'EMAIL_LINK', 'IN_PERSON_SIGNATURE');
CREATE TYPE "AuthorizationDecision" AS ENUM ('APPROVED', 'DECLINED', 'DELIVERY_ACKNOWLEDGED');
CREATE TYPE "AuthorizationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED', 'REVOKED', 'SUPERSEDED');

CREATE TABLE "document_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "document_type" "DocumentEvidenceType" NOT NULL,
  "document_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshot_sha256" TEXT NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_revisions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "document_revisions_shop_id_document_type_document_id_revision_key" ON "document_revisions"("shop_id", "document_type", "document_id", "revision");
CREATE INDEX "document_revisions_shop_id_document_type_document_id_idx" ON "document_revisions"("shop_id", "document_type", "document_id");
CREATE INDEX "document_revisions_shop_id_snapshot_sha256_idx" ON "document_revisions"("shop_id", "snapshot_sha256");

CREATE TABLE "authorization_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "document_revision_id" UUID NOT NULL,
  "recipient_name" TEXT,
  "recipient_email" TEXT,
  "token_sha256" TEXT NOT NULL,
  "status" "AuthorizationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sent_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "superseded_at" TIMESTAMP(3),
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "authorization_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "authorization_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "authorization_requests_document_revision_id_fkey" FOREIGN KEY ("document_revision_id") REFERENCES "document_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "authorization_requests_token_sha256_key" ON "authorization_requests"("token_sha256");
CREATE INDEX "authorization_requests_shop_id_document_revision_id_idx" ON "authorization_requests"("shop_id", "document_revision_id");

CREATE TABLE "authorization_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "document_revision_id" UUID NOT NULL,
  "authorization_request_id" UUID,
  "method" "AuthorizationMethod" NOT NULL,
  "decision" "AuthorizationDecision" NOT NULL,
  "authorizer_name" TEXT NOT NULL,
  "authorizer_relationship" TEXT,
  "amount_authorized" DECIMAL(12,2),
  "total_discussed" DECIMAL(12,2),
  "notes" TEXT,
  "staff_user_id" UUID,
  "staff_user_email" TEXT,
  "consent_text" TEXT,
  "consent_version" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "authorization_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "authorization_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "authorization_events_document_revision_id_fkey" FOREIGN KEY ("document_revision_id") REFERENCES "document_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "authorization_events_authorization_request_id_fkey" FOREIGN KEY ("authorization_request_id") REFERENCES "authorization_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "authorization_events_shop_id_document_revision_id_occurred_at_idx" ON "authorization_events"("shop_id", "document_revision_id", "occurred_at");

CREATE TABLE "signature_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL,
  "authorization_event_id" UUID NOT NULL,
  "mime_type" TEXT NOT NULL,
  "signature_data" TEXT NOT NULL,
  "signature_sha256" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signature_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "signature_evidence_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "signature_evidence_authorization_event_id_fkey" FOREIGN KEY ("authorization_event_id") REFERENCES "authorization_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "signature_evidence_authorization_event_id_key" ON "signature_evidence"("authorization_event_id");
CREATE INDEX "signature_evidence_shop_id_created_at_idx" ON "signature_evidence"("shop_id", "created_at");