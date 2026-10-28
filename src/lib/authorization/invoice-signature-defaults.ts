import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";
import { ensureShopSignatureDefaultsStorage } from "@/lib/authorization/shop-signature-defaults-storage";

const DEFAULT_OWNER_NAME = "Subbu Veerappan";
const PREFERRED_SOURCE_REPAIR_ORDER = "21861";

type ConfiguredSignatureRow = {
  representativeName: string | null;
  signatureData: string;
};

type DefaultSignatureRow = {
  signerName: string;
  signatureData: string;
};

export async function getInvoiceDeliverySignatureDefaults() {
  const { membership } = await getCurrentMembership();
  if (!membership) {
    return { shopRepresentativeName: DEFAULT_OWNER_NAME, shopRepresentativeSignatureData: "" };
  }

  await ensureShopSignatureDefaultsStorage();

  const configured = await prisma.$queryRaw<ConfiguredSignatureRow[]>`
    SELECT
      COALESCE(NULLIF(BTRIM(s.default_authorized_representative), ''), d.representative_name) AS "representativeName",
      d.signature_data AS "signatureData"
    FROM shop_signature_defaults d
    JOIN shops s ON s.id = d.shop_id
    WHERE d.shop_id = ${membership.shopId}::uuid
    LIMIT 1
  `;

  if (configured[0]?.signatureData) {
    return {
      shopRepresentativeName: configured[0].representativeName ?? DEFAULT_OWNER_NAME,
      shopRepresentativeSignatureData: configured[0].signatureData,
    };
  }

  const rows = await prisma.$queryRaw<DefaultSignatureRow[]>`
    SELECT
      ae.authorizer_name AS "signerName",
      se.signature_data AS "signatureData"
    FROM authorization_events ae
    JOIN document_revisions dr
      ON dr.id = ae.document_revision_id
      AND dr.shop_id = ae.shop_id
    JOIN signature_evidence se
      ON se.authorization_event_id = ae.id
      AND se.shop_id = ae.shop_id
    WHERE ae.shop_id = ${membership.shopId}::uuid
      AND dr.document_type = 'INVOICE'::"DocumentEvidenceType"
      AND ae.method = 'IN_PERSON_SIGNATURE'::"AuthorizationMethod"
      AND ae.decision = 'DELIVERY_ACKNOWLEDGED'::"AuthorizationDecision"
      AND ae.signature_role = 'SHOP_REPRESENTATIVE'::"SignatureRole"
    ORDER BY
      CASE WHEN LOWER(TRIM(ae.authorizer_name)) = LOWER(${DEFAULT_OWNER_NAME}) THEN 0 ELSE 1 END,
      CASE WHEN dr.snapshot #>> '{invoice,number}' = ${PREFERRED_SOURCE_REPAIR_ORDER} THEN 0 ELSE 1 END,
      ae.occurred_at DESC,
      ae.id DESC
    LIMIT 1
  `;

  return {
    shopRepresentativeName: rows[0]?.signerName || DEFAULT_OWNER_NAME,
    shopRepresentativeSignatureData: rows[0]?.signatureData ?? "",
  };
}
