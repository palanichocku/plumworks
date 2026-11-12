-- Authorization/signature evidence is compliance history and must be append-only.
-- authorization_requests is intentionally excluded because request lifecycle status
-- legitimately transitions through PENDING/APPROVED/DECLINED/EXPIRED/REVOKED/SUPERSEDED.

CREATE OR REPLACE FUNCTION public.reject_authorization_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable authorization evidence: % is not allowed on public.%', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS document_revisions_immutable ON public.document_revisions;
CREATE TRIGGER document_revisions_immutable
BEFORE UPDATE OR DELETE ON public.document_revisions
FOR EACH ROW
EXECUTE FUNCTION public.reject_authorization_evidence_mutation();

DROP TRIGGER IF EXISTS authorization_events_immutable ON public.authorization_events;
CREATE TRIGGER authorization_events_immutable
BEFORE UPDATE OR DELETE ON public.authorization_events
FOR EACH ROW
EXECUTE FUNCTION public.reject_authorization_evidence_mutation();

DROP TRIGGER IF EXISTS signature_evidence_immutable ON public.signature_evidence;
CREATE TRIGGER signature_evidence_immutable
BEFORE UPDATE OR DELETE ON public.signature_evidence
FOR EACH ROW
EXECUTE FUNCTION public.reject_authorization_evidence_mutation();
