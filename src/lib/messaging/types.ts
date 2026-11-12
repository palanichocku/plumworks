export type SmsDeliveryRequest = {
  /** E.164-formatted recipient and sender numbers. */
  to: string;
  from: string;
  /** Include the secure approval URL; never send an approval token in logs. */
  body: string;
  /** Per-request webhook endpoint for delivery and failure reconciliation. */
  statusCallbackUrl?: string;
};

export type SmsDeliveryResult =
  | { ok: true; providerMessageId: string; status: "accepted" }
  | { ok: false; errorCode: string; message: string };

export interface SmsProvider {
  readonly name: string;
  send(request: SmsDeliveryRequest): Promise<SmsDeliveryResult>;
}
