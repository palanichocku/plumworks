export type EvidenceDocumentType = "REPAIR_ORDER" | "INVOICE";
export type AuthorizationMethod = "PHONE" | "EMAIL_LINK" | "IN_PERSON_SIGNATURE";
export type AuthorizationDecision = "APPROVED" | "DECLINED" | "DELIVERY_ACKNOWLEDGED";
export type AuthorizationRequestStatus = "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "REVOKED" | "SUPERSEDED";

export type VerbalAuthorizationInput = {
  repairOrderId: string;
  authorizerName: string;
  authorizerRelationship?: string;
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
  authorizerRelationship: string | null;
  amountAuthorized: string | null;
  totalDiscussed: string | null;
  notes: string | null;
  staffUserEmail: string | null;
  occurredAt: Date;
  snapshotSha256: string;
};

export type RepairOrderAuthorizationStatus =
  | "NOT_AUTHORIZED"
  | "AUTHORIZED"
  | "DECLINED"
  | "DECLINED_PREVIOUS_REVISION";

export type RepairOrderAuthorizationSummary = {
  status: RepairOrderAuthorizationStatus;
  currentSnapshotSha256: string;
  approvedRevision: number | null;
  approvedAt: Date | null;
  authorizerName: string | null;
  decisionRevision: number | null;
  decisionAt: Date | null;
  decisionAuthorizerName: string | null;
};
