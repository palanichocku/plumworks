-- Development SMS inbound diagnostic. No existing records are modified.
ALTER TABLE "sms_inbound_events" ADD COLUMN IF NOT EXISTS "twilio_opt_out_type" TEXT;
COMMENT ON COLUMN "sms_inbound_events"."twilio_opt_out_type" IS 'Verified Twilio OptOutType keyword (STOP, HELP, START) or NULL if absent.';
