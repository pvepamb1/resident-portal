import type { Result } from './result';

/**
 * What core needs to know about the currently authenticated party, after the
 * Auth adapter has proven control of an identifier -- nothing more (AD-5:
 * "every sign-in method authenticates through the Auth port purely to prove
 * control of one identifier"). Mapping this to a landlord or tenant record
 * is a separate, application-owned resolution step in core/identity.
 */
export interface AuthIdentity {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
}

/**
 * Port core depends on for session/identity concerns. The concrete
 * implementation (adapters/auth) wraps Better Auth; core never imports
 * Better Auth directly (AD-1).
 */
export interface AuthPort {
  /** Resolves the current session (if any) from an incoming request's headers. */
  getIdentityFromHeaders(headers: Headers): Promise<Result<AuthIdentity | null>>;

  /**
   * Invalidates every active session for a user immediately. Not used by
   * this story (no tenancy-end flow yet -- that's CAP-8/AD-6), but the
   * shape is defined here so AD-6's implementation extends this port
   * instead of inventing a second one.
   */
  revokeAllSessionsForUser(userId: string): Promise<Result<void>>;
}
