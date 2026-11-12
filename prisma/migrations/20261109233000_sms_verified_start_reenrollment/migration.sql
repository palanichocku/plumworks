-- Development SMS START re-enrollment (STOP history remains immutable).
-- A cleared suppression is no longer active, but the STOP row is retained.
ALTER TABLE public.sms_phone_suppressions
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

ALTER TABLE public.sms_inbound_events
  DROP CONSTRAINT IF EXISTS sms_inbound_events_keyword_check;
ALTER TABLE public.sms_inbound_events
  ADD CONSTRAINT sms_inbound_events_keyword_check
  CHECK (keyword IN ('STOP', 'HELP', 'START'));

COMMENT ON COLUMN public.sms_phone_suppressions.cleared_at IS
  'Verified Twilio START lifted sender-level STOP suppression; historical STOP record remains.';
