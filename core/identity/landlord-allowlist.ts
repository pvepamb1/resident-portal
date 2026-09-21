import { normalizeEmail, normalizedIdentifierEquals, normalizePhone } from './normalize';

/**
 * The one pre-configured landlord identity (CAP-7, AD-5 "no ambiguity,
 * exactly one identity permitted"). Email is required; phone is optional --
 * if unset, phone+OTP sign-in can never resolve to the landlord, which is
 * the safe default (no path accidentally grants landlord access).
 */
export interface LandlordAllowlist {
  email: string;
  phone: string | null;
}

export function loadLandlordAllowlistFromEnv(env: NodeJS.ProcessEnv = process.env): LandlordAllowlist {
  const rawEmail = env.LANDLORD_ALLOWLIST_EMAIL?.trim();
  if (!rawEmail) {
    throw new Error(
      'LANDLORD_ALLOWLIST_EMAIL is not set. Refusing to start without an allowlisted landlord identity (SPEC.md non-goal: no open landlord self-registration).',
    );
  }
  // Normalize before this value is ever persisted (via createLandlord) or
  // compared -- falling back to the trimmed raw value only if
  // normalization fails, so the fail-fast check above still governs
  // "missing" rather than "malformed".
  const email = normalizeEmail(rawEmail) ?? rawEmail;

  const rawPhone = env.LANDLORD_ALLOWLIST_PHONE?.trim();
  const phone = rawPhone && rawPhone.length > 0 ? (normalizePhone(rawPhone) ?? rawPhone) : null;

  return { email, phone };
}

/**
 * A proven identifier from a completed sign-in (Auth port has already
 * confirmed control of it) -- this function only decides whether it maps to
 * the allowlisted landlord. It does not create, look up, or mutate anything;
 * callers turn `false` into a single generic "not authorized" response with
 * no indication of how close the identifier came to matching (I/O matrix:
 * "do not reveal whether the identity was almost recognized").
 */
export function matchesLandlordAllowlist(
  identity: { email: string | null; phone: string | null },
  allowlist: LandlordAllowlist,
): boolean {
  if (normalizedIdentifierEquals('email', identity.email, allowlist.email)) return true;
  if (allowlist.phone && normalizedIdentifierEquals('phone', identity.phone, allowlist.phone)) return true;
  return false;
}
