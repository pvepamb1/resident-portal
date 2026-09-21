import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { magicLink, phoneNumber } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db';
import * as authSchema from '@/db/auth-schema';
import { normalizePhone } from '@/core/identity/normalize';
import { createNotifierFromEnv } from '@/adapters/notify';

/**
 * Better Auth wiring shared by landlord (this story) and future tenant use
 * (AD-1: "all three sign-in methods share one Auth port implementation").
 * Better Auth only proves control of an identifier here -- role/identity
 * resolution (allowlist match for the landlord; on-file match for tenants
 * in Story 3) happens in core/identity, never inside this file.
 *
 * Session strategy: Better Auth's default is a DB-backed session record
 * (the `session` table), checked on every request via the adapter -- not a
 * stateless self-contained token. That satisfies AD-6's requirement for a
 * session shape capable of live server-side revocation, so no JWT plugin is
 * used anywhere in this system.
 */

const notifier = createNotifierFromEnv();

function requireEnv(name: 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Refusing to start Better Auth without it.`);
  }
  return value;
}

export const auth = betterAuth({
  secret: requireEnv('BETTER_AUTH_SECRET'),
  baseURL: requireEnv('BETTER_AUTH_URL'),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: authSchema,
  }),
  rateLimit: {
    customRules: {
      // Better Auth's generic default (100 requests/10s) is far too loose
      // for an endpoint that triggers a cost-bearing SMS send each time;
      // its tighter built-in rule only covers `/sign-in*` paths (already
      // protecting magic-link), not this one.
      '/phone-number/send-otp': { window: 60, max: 3 },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  plugins: [
    phoneNumber({
      otpLength: 6,
      expiresIn: 300,
      // Reject obviously malformed numbers before an OTP is even sent --
      // final identity comparison still always renormalizes (AD-5).
      phoneNumberValidator: (phoneNumberInput) => normalizePhone(phoneNumberInput) !== null,
      signUpOnVerification: {
        // Phone-first sign-up needs a placeholder email; this is never
        // treated as a real on-file identifier by core/identity.
        getTempEmail: (phoneNumberInput) => `phone-${phoneNumberInput.replace(/[^0-9]/g, '')}@phone.invalid`,
      },
      sendOTP: async ({ phoneNumber: to, code }) => {
        const result = await notifier.sendSms({
          to,
          body: `Your Resident Portal verification code is ${code}. It expires in 5 minutes.`,
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
      },
    }),
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        const result = await notifier.sendEmail({
          to: email,
          subject: 'Your Resident Portal sign-in link',
          html: `<p>Click below to sign in. This link expires in 15 minutes and can only be used once.</p><p><a href="${url}">${url}</a></p>`,
          text: `Sign in using this link (expires in 15 minutes, one-time use): ${url}`,
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
      },
    }),
    // Must be last: lets server actions calling auth.api.* set cookies.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
