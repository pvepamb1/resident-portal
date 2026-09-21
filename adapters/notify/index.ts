import type { EmailMessage, Notifier, SmsMessage } from '@/ports/notifier';
import type { Result } from '@/ports/result';
import { createMsg91SmsNotifier, type Msg91SmsNotifierConfig } from './msg91-sms-notifier';
import { createResendEmailNotifier, type ResendEmailNotifierConfig } from './resend-email-notifier';

export { createMsg91SmsNotifier, createResendEmailNotifier };
export type { Msg91SmsNotifierConfig, ResendEmailNotifierConfig };

/**
 * Composes the email-capable (Resend) and SMS-capable (MSG91) adapters into
 * one Notifier that routes each call to the adapter that actually
 * implements it. This is the Notifier wired at the app layer.
 */
export function createCompositeNotifier(email: Notifier, sms: Notifier): Notifier {
  return {
    sendEmail(message: EmailMessage): Promise<Result<void>> {
      return email.sendEmail(message);
    },
    sendSms(message: SmsMessage): Promise<Result<void>> {
      return sms.sendSms(message);
    },
  };
}

export function createNotifierFromEnv(env: NodeJS.ProcessEnv = process.env): Notifier {
  const email = createResendEmailNotifier({
    apiKey: env.RESEND_API_KEY ?? '',
    // `onboarding@resend.dev` is Resend's shared sandbox address -- it can
    // only deliver to the Resend account owner's own verified email, never
    // to a real tenant. A verified custom domain must be configured in
    // RESEND_FROM_EMAIL before tenant invitations can actually be
    // delivered.
    fromAddress: env.RESEND_FROM_EMAIL ?? 'Resident Portal <onboarding@resend.dev>',
  });
  const sms = createMsg91SmsNotifier({
    authKey: env.MSG91_AUTH_KEY ?? '',
    senderId: env.MSG91_SENDER_ID ?? '',
  });
  return createCompositeNotifier(email, sms);
}
