ALTER TABLE public.shop_signature_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_security_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shop_signature_defaults FROM PUBLIC;
REVOKE ALL ON TABLE public.shop_signature_defaults FROM anon;
REVOKE ALL ON TABLE public.shop_signature_defaults FROM authenticated;

REVOKE ALL ON TABLE public.shop_security_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.shop_security_settings FROM anon;
REVOKE ALL ON TABLE public.shop_security_settings FROM authenticated;
