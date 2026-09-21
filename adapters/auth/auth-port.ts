import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/auth-schema';
import type { AuthIdentity, AuthPort } from '@/ports/auth';
import { err, ok, type Result } from '@/ports/result';
import { auth } from './index';

/**
 * AuthPort implementation wrapping Better Auth. Core only ever sees
 * `AuthIdentity` -- proof of control of an identifier, nothing more
 * (AD-5) -- never Better Auth's own types.
 */
export const authPort: AuthPort = {
  async getIdentityFromHeaders(headers: Headers): Promise<Result<AuthIdentity | null>> {
    try {
      const result = await auth.api.getSession({ headers });
      if (!result) return ok(null);

      const user = result.user as typeof result.user & {
        phoneNumber?: string | null;
        phoneNumberVerified?: boolean | null;
      };

      return ok({
        userId: user.id,
        email: user.email ?? null,
        emailVerified: user.emailVerified ?? false,
        phoneNumber: user.phoneNumber ?? null,
        phoneNumberVerified: user.phoneNumberVerified ?? false,
      });
    } catch (cause) {
      return err({
        code: 'AUTH_SESSION_LOOKUP_FAILED',
        message: cause instanceof Error ? cause.message : 'Failed to resolve the current session.',
        cause,
      });
    }
  },

  async revokeAllSessionsForUser(userId: string): Promise<Result<void>> {
    try {
      await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
      return ok(undefined);
    } catch (cause) {
      return err({
        code: 'AUTH_SESSION_REVOKE_FAILED',
        message: cause instanceof Error ? cause.message : 'Failed to revoke sessions.',
        cause,
      });
    }
  },
};
