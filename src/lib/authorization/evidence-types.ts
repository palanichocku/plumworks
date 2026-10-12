export type EvidenceDocumentType = "REPAIR_ORDER" | "INVOICE";
export type AuthorizationMethod = "PHONE" | "EMAIL_LINK" | "IN_PERSON_SIGNATURE";
export type AuthorizationDecision = "APPROVED" | "DECLINED" | "DELIVERY_ACKNOWLEDGED";
export type AuthorizationRequestStatus = "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "REVOKED" | "SUPERSEDED";

export type VerbalAuthorizationInput = {
  repairOrderId: string;
  authorizerName: string;
  amountAuthorized: string;
  totalDiscussed: string;
  notes?: string;
};

export type AuthorizationHistoryItem = {
  id: string;
  revision: number;
  method: AuthorizationMethod;
  decision: AuthorizationDecision;
  authorizerName: string;
  amountAuthorized: string | null;
  totalDiscussed: string | null;
  notes: string | null;
  staffUserEmail: string | null;
  occurredAt: Date;
  snapshotSha256: string;
};
