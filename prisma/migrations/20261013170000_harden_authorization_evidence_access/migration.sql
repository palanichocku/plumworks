-- Authorization evidence tables are intentionally migration-managed and are
-- accessed only through trusted server-side SQL. Bring them under the same
-- RLS/privilege baseline as the rest of the application tables.

ALTER TABLE "document_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signature_evidence" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "document_revisions" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "document_revisions" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE "document_revisions" FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE "document_revisions" TO service_role;

REVOKE ALL PRIVILEGES ON TABLE "authorization_requests" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "authorization_requests" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE "authorization_requests" FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE "authorization_requests" TO service_role;

REVOKE ALL PRIVILEGES ON TABLE "authorization_events" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "authorization_events" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE "authorization_events" FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE "authorization_events" TO service_role;

REVOKE ALL PRIVILEGES ON TABLE "signature_evidence" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "signature_evidence" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE "signature_evidence" FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE "signature_evidence" TO service_role;
