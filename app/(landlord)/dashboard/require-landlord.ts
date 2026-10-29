import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authPort } from '@/adapters/auth/auth-port';
import { drizzleRepository } from '@/adapters/db/repository';
import { loadLandlordAllowlistFromEnv } from '@/core/identity/landlord-allowlist';
import { resolveLandlordAccess } from '@/core/identity/landlord';
import type { Landlord } from '@/core/identity/types';

/**
 * The one gate every dashboard page and server action calls. Re-checked on
 * every mutation (not just once in the layout) -- a server action is its
 * own reachable endpoint, so it can't rely solely on the page that renders
 * its form having already gated access.
 *
 * Every rejection reason collapses to the same redirect (I/O matrix: "do
 * not reveal whether the identity was almost recognized").
 *
 * Wrapped in React's `cache()` so `layout.tsx` and `page.tsx` -- both
 * rendered within the same request -- share one session+DB lookup instead
 * of each doing its own. Server actions are separate requests/invocations
 * and always get a fresh check, which is intentional (see above).
 */
export const requireLandlordSession = cache(async (): Promise<{ landlord: Landlord; authUserId: string }> => {
  const identityResult = await authPort.getIdentityFromHeaders(await headers());
  const identity = identityResult.ok ? identityResult.value : null;

  const allowlist = loadLandlordAllowlistFromEnv();
  const accessResult = await resolveLandlordAccess(drizzleRepository, identity, allowlist);

  if (!identity || !accessResult.ok || accessResult.value.kind === 'denied') {
    redirect('/login?error=not_authorized');
  }

  return { landlord: accessResult.value.landlord, authUserId: identity.userId };
});

export async function requireLandlord(): Promise<Landlord> {
  return (await requireLandlordSession()).landlord;
}
