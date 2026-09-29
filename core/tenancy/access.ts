import type { RepositoryPort } from '@/ports/repository';
import { ok, type Result } from '@/ports/result';
import type { TenantWithLease } from '@/core/identity/types';

export type TenantAccess =
  | { kind: 'allowed'; tenancy: TenantWithLease }
  /** A tenant is linked to this user, but no linked tenancy is active (CAP-8). */
  | { kind: 'revoked' }
  /** No tenant is linked to this auth user (yet). */
  | { kind: 'unknown' };

/**
 * THE tenant access guarantee (CAP-8, AD-6). Session deletion on End only
 * shortens the window; this check is what makes an ended tenancy unable to
 * regain access. Story 3's tenant gate must call it both at identity
 * resolution and on every tenant request, and on `revoked` delete the
 * newly issued session (this also covers magic links / OTPs issued before
 * End, whose `verification` rows are not cleared).
 *
 * `allowed` only when a tenant linked to this auth user has an active lease.
 */
export async function resolveTenantAccess(
  repository: RepositoryPort,
  authUserId: string,
): Promise<Result<TenantAccess>> {
  const tenancies = await repository.listTenanciesByAuthUserId(authUserId);
  if (!tenancies.ok) return tenancies;
  if (tenancies.value.length === 0) return ok({ kind: 'unknown' });
  const active = tenancies.value.find((tenancy) => tenancy.lease.status === 'active');
  return ok(active ? { kind: 'allowed', tenancy: active } : { kind: 'revoked' });
}
