import { Resend } from 'resend';
import type { EmailMessage, Notifier, SmsMessage } from '@/ports/notifier';
import { err, ok, type Result } from '@/ports/result';

export interface ResendEmailNotifierConfig {
  apiKey: string;
  fromAddress: string;
}

/**
 * Email-capable Notifier implementation backed by Resend. `sendSms` returns
 * a typed "unsupported channel" error rather than throwing, so this adapter
 * stays a fully interchangeable Notifier from core's point of view (AD-1)
 * even though it only actually delivers one channel.
 */
export function createResendEmailNotifier(config: ResendEmailNotifierConfig): Notifier {
  // Constructed lazily, on first send: the Resend SDK validates its API key
  // synchronously in its constructor, and this adapter is instantiated at
  // module load (including during `next build`'s route analysis, before
  // any real request exists) -- an empty/placeholder key must not crash
  // that, only an actual send attempt should surface the error.
  let client: Resend | null = null;

  return {
    async sendEmail(message: EmailMessage): Promise<Result<void>> {
      try {
        client ??= new Resend(config.apiKey);
        const { error } = await client.emails.send({
          from: config.fromAddress,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        if (error) {
          return err({ code: 'NOTIFY_EMAIL_FAILED', message: error.message, cause: error });
        }
        return ok(undefined);
      } catch (cause) {
        return err({
          code: 'NOTIFY_EMAIL_FAILED',
          message: cause instanceof Error ? cause.message : 'Failed to send email via Resend.',
          cause,
        });
      }
    },

    async sendSms(_message: SmsMessage): Promise<Result<void>> {
      return err({ code: 'UNSUPPORTED_CHANNEL', message: 'The Resend adapter does not support SMS.' });
    },
  };
}
