ALTER TABLE public."invoice_legacy_charges"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public."invoice_legacy_charges"
  FROM anon, authenticated;
