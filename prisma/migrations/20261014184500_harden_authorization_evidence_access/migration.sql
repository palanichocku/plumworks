-- Bring migration-managed authorization evidence under the same API/security
-- baseline as the rest of PlumWorks public application tables.

ALTER TABLE public.document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorization_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.authorization_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.authorization_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.signature_evidence FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_revisions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.authorization_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.authorization_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.signature_evidence TO service_role;
