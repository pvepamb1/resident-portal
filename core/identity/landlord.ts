import type { AuthIdentity } from '@/ports/auth';
import type { RepositoryPort } from '@/ports/repository';
import { ok, type Result } from '@/ports/result';
import { matchesLandlordAllowlist, type LandlordAllowlist } from './landlord-allowlist';
import type { Landlord } from './types';

export type LandlordAccessResult = { kind: 'granted'; landlord: Landlord } | { kind: 'denied' };

/**
 * Single entry point the dashboard boundary calls to decide landlord
 * access. Every rejection reason -- no session, wrong identity, provider
 * sign-in succeeded but identity isn't allowlisted -- collapses to the same
 * 'denied' outcome, so the caller can render one generic "not authorized"
 * response (I/O matrix: "do not reveal whether the identity was almost
 * recognized").
 *
 * This is also the *only* call site that may create a `landlords` row
 * (materialized lazily on the allowlisted identity's first successful
 * sign-in) -- no other code path creates a landlord account (SPEC.md
 * non-goal).
 */
export async function resolveLandlordAccess(
  repository: RepositoryPort,
  identity: AuthIdentity | null,
  allowlist: LandlordAllowlist,
): Promise<Result<LandlordAccessResult>> {
  if (!identity) return ok({ kind: 'denied' });

  const matches = matchesLandlordAllowlist(
    { email: identity.email, phone: identity.phoneNumber },
    allowlist,
  );
  if (!matches) return ok({ kind: 'denied' });

  const existing = await repository.getLandlordByEmail(allowlist.email);
  if (!existing.ok) return existing;
  if (existing.value) return ok({ kind: 'granted', landlord: existing.value });

  const created = await repository.createLandlord({
    email: allowlist.email,
    phone: allowlist.phone,
    name: 'Landlord',
  });
  if (created.ok) return ok({ kind: 'granted', landlord: created.value });

  // Two near-simultaneous first sign-ins can both see "no landlord yet" and
  // both attempt to create one; the loser hits the table's unique
  // constraint rather than silently producing a second row (SPEC.md
  // non-goal). Re-fetch and use the winner's row instead of failing.
  if (created.error.code === 'ALREADY_EXISTS') {
    const afterRace = await repository.getLandlordByEmail(allowlist.email);
    if (!afterRace.ok) return afterRace;
    if (afterRace.value) return ok({ kind: 'granted', landlord: afterRace.value });
  }

  return created;
}
