-- Development-only foundation for multi-tenant SMS consent.
-- No existing rows are granted consent. This migration does not send SMS.
CREATE TABLE sms_consent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (left(phone_e164, 1) = '+' AND substring(phone_e164 from 2) ~ '^[1-9][0-9]{7,14}$'),
  token_sha256 char(64) NOT NULL UNIQUE,
  staff_pin_sha256 char(64) NOT NULL,
  disclosure_version varchar(80) NOT NULL,
  collection_method text NOT NULL CHECK (collection_method IN ('IN_SHOP_IPAD', 'IN_SHOP_QR')),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  failed_pin_attempts integer NOT NULL DEFAULT 0 CHECK (failed_pin_attempts BETWEEN 0 AND 5),
  CONSTRAINT sms_consent_sessions_expiration CHECK (expires_at > created_at)
);
CREATE INDEX sms_consent_sessions_customer_idx
  ON sms_consent_sessions(shop_id, customer_id, created_at DESC);

CREATE TABLE sms_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  session_id uuid REFERENCES sms_consent_sessions(id) ON DELETE SET NULL,
  phone_e164 text NOT NULL CHECK (left(phone_e164, 1) = '+' AND substring(phone_e164 from 2) ~ '^[1-9][0-9]{7,14}$'),
  event_type text NOT NULL CHECK (event_type IN ('OPT_IN', 'OPT_OUT')),
  method text NOT NULL CHECK (method IN ('IN_SHOP_QR', 'IN_SHOP_IPAD', 'TWILIO_STOP', 'STAFF_VERIFIED')),
  disclosure_version varchar(80),
  disclosure_text text,
  customer_name text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_consent_events_opt_in_disclosure CHECK (
    event_type <> 'OPT_IN' OR (disclosure_version IS NOT NULL AND disclosure_text IS NOT NULL)
  )
);
CREATE INDEX sms_consent_events_customer_phone_idx
  ON sms_consent_events(shop_id, customer_id, phone_e164, occurred_at DESC, id DESC);
CREATE INDEX sms_consent_events_phone_idx
  ON sms_consent_events(shop_id, phone_e164, occurred_at DESC, id DESC);

-- Opt-out is enforced by destination number across customers within the same shop.
-- Never infer consent from an existing phone number or legacy import.
CREATE TABLE sms_phone_suppressions (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (left(phone_e164, 1) = '+' AND substring(phone_e164 from 2) ~ '^[1-9][0-9]{7,14}$'),
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  PRIMARY KEY (shop_id, phone_e164)
);

-- Defense in depth: these tables are accessed via authorized server routes only.
ALTER TABLE sms_consent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_phone_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sms_consent_sessions, sms_consent_events, sms_phone_suppressions FROM anon, authenticated;
