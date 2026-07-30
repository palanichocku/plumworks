REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM service_role;

ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
