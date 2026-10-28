import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";

const DEFAULT_OWNER_NAME = "Subbu Veerappan";
const PREFERRED_SOURCE_REPAIR_ORDER = "21861";

type DefaultSignatureRow = {
  signerName: string;
  signatureData: string;
};

export async function getInvoiceDeliverySignatureDefaults() {
  const { membership } = await getCurrentMembership();
  if (!membership) {
    return { shopRepresentativeName: DEFAULT_OWNER_NAME, shopRepresentativeSignatureData: "" };
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
      CASE WHEN dr.snapshot #>> '{invoice,number}' = ${PREFERRED_SOURCE_REPAIR_ORDER} THEN 0 ELSE 1 END,
      CASE WHEN LOWER(ae.authorizer_name) = LOWER(${DEFAULT_OWNER_NAME}) THEN 0 ELSE 1 END,
      ae.occurred_at DESC,
      ae.id DESC
    LIMIT 1
  `;

  return {
    shopRepresentativeName: DEFAULT_OWNER_NAME,
    shopRepresentativeSignatureData: rows[0]?.signatureData ?? "",
  };
}
