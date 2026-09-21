import type { EmailMessage, Notifier, SmsMessage } from '@/ports/notifier';
import { err, ok, type Result } from '@/ports/result';

export interface Msg91SmsNotifierConfig {
  authKey: string;
  /** TRAI-registered 6-character alphanumeric sender id, e.g. "RESPRT". */
  senderId: string;
  /** Overridable for testing; defaults to MSG91's transactional SMS v2 endpoint. */
  apiBaseUrl?: string;
}

interface Msg91SendSmsResponse {
  type: string;
  message?: string;
}

/**
 * SMS-capable Notifier implementation backed by MSG91's transactional SMS
 * API (route 4 = transactional, no promotional/DND restriction) -- chosen
 * over Twilio for India pricing and over a Firebase-based bridge, per
 * SPEC decisions. `sendEmail` returns a typed "unsupported channel" error
 * rather than throwing, keeping this adapter interchangeable with any
 * other Notifier from core's point of view (AD-1).
 *
 * This delivers an already-generated OTP code (Better Auth's phone-number
 * plugin owns generation/verification) -- it does not use MSG91's own
 * OTP-widget product.
 */
export function createMsg91SmsNotifier(config: Msg91SmsNotifierConfig): Notifier {
  const apiBaseUrl = config.apiBaseUrl ?? 'https://api.msg91.com/api/v2/sendsms';

  return {
    async sendEmail(_message: EmailMessage): Promise<Result<void>> {
      return err({ code: 'UNSUPPORTED_CHANNEL', message: 'The MSG91 adapter does not support email.' });
    },

    async sendSms(message: SmsMessage): Promise<Result<void>> {
      // MSG91 expects the destination without a leading "+".
      const to = message.to.replace(/^\+/, '');

      try {
        const response = await fetch(apiBaseUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authkey: config.authKey,
          },
          body: JSON.stringify({
            sender: config.senderId,
            route: '4',
            country: '91',
            sms: [{ message: message.body, to: [to] }],
          }),
          signal: AbortSignal.timeout(10_000),
        });

        const body = (await response.json().catch(() => null)) as Msg91SendSmsResponse | null;

        // Require an explicit "success" rather than merely the absence of
        // "error" -- a null/unparseable body or an unexpected shape must
        // not be treated as a successful send.
        if (!response.ok || body?.type !== 'success') {
          return err({
            code: 'NOTIFY_SMS_FAILED',
            message: body?.message ?? `MSG91 request failed with status ${response.status}.`,
            cause: body,
          });
        }

        return ok(undefined);
      } catch (cause) {
        return err({
          code: 'NOTIFY_SMS_FAILED',
          message: cause instanceof Error ? cause.message : 'Failed to send SMS via MSG91.',
          cause,
        });
      }
    },
  };
}
