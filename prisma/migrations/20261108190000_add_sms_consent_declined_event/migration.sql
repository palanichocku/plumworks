-- Consent declined is a deliberate choice, not a carrier STOP / number suppression.
ALTER TABLE sms_consent_events DROP CONSTRAINT sms_consent_events_event_type_check;
ALTER TABLE sms_consent_events ADD CONSTRAINT sms_consent_events_event_type_check
  CHECK (event_type IN ('OPT_IN', 'OPT_OUT', 'DECLINED'));
