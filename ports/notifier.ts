import type { Result } from './result';

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Any failure to deliver an attachment fails the whole send. Never log attachment content. */
  attachments?: EmailAttachment[];
}

export interface SmsMessage {
  to: string;
  body: string;
}

/**
 * Port core depends on for outbound messaging. AD-1: Notifier calls fire
 * only after their triggering state change has committed successfully --
 * callers in core/identity are responsible for that ordering, this port
 * only defines the delivery contract.
 *
 * A single adapter may only support one channel (e.g. the Resend adapter
 * has no SMS capability) -- it still implements the full interface and
 * returns a typed error for the unsupported channel rather than throwing,
 * so it stays interchangeable with any other Notifier from core's point of
 * view (AD-1). adapters/notify/index.ts composes the email-capable and
 * sms-capable adapters into one Notifier that routes each call correctly.
 */
export interface Notifier {
  sendEmail(message: EmailMessage): Promise<Result<void>>;
  sendSms(message: SmsMessage): Promise<Result<void>>;
}
