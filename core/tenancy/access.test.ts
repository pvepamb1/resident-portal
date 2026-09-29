import { describe, expect, it, vi } from 'vitest';
import type { RepositoryPort } from '@/ports/repository';
import { err, ok } from '@/ports/result';
import type { TenantWithLease } from '@/core/identity/types';
import { resolveTenantAccess } from './access';

function tenancy(status: 'active' | 'ended', id = 'lease-1'): TenantWithLease {
  const now = new Date();
  return {
    tenant: {
      id: 'tenant-1',
      landlordId: 'landlord-1',
      name: 'T',
      email: 't@example.com',
      phone: '+919876543210',
      invitationStatus: 'active',
      authUserId: 'user-1',
      createdAt: now,
      updatedAt: now,
    },
    unit: { id: 'unit-1', landlordId: 'landlord-1', label: 'U', createdAt: now, updatedAt: now },
    lease: {
      id,
      unitId: 'unit-1',
      tenantId: 'tenant-1',
      startDate: now,
      endDate: null,
      rentAmountPaise: 100,
      status,
      endedAt: status === 'ended' ? now : null,
      endedBy: status === 'ended' ? 'landlord-1' : null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function repo(result: Awaited<ReturnType<RepositoryPort['listTenanciesByAuthUserId']>>): RepositoryPort {
  return { listTenanciesByAuthUserId: vi.fn(async () => result) } as unknown as RepositoryPort;
}

describe('resolveTenantAccess', () => {
  it('allows a user linked to a tenant with an active lease', async () => {
    const active = tenancy('active');
    expect(await resolveTenantAccess(repo(ok([active])), 'user-1')).toEqual(ok({ kind: 'allowed', tenancy: active }));
  });

  it('revokes a user whose only tenancy has ended', async () => {
    expect(await resolveTenantAccess(repo(ok([tenancy('ended')])), 'user-1')).toEqual(ok({ kind: 'revoked' }));
  });

  it('is unknown when no tenant is linked to the user', async () => {
    expect(await resolveTenantAccess(repo(ok([])), 'user-1')).toEqual(ok({ kind: 'unknown' }));
  });

  it('allows when at least one linked lease is active', async () => {
    const active = tenancy('active', 'lease-2');
    expect(await resolveTenantAccess(repo(ok([tenancy('ended'), active])), 'user-1')).toEqual(
      ok({ kind: 'allowed', tenancy: active }),
    );
  });

  it('propagates repository errors (never defaults to allowed)', async () => {
    const failure = err({ code: 'DB_ERROR', message: 'boom' });
    expect(await resolveTenantAccess(repo(failure), 'user-1')).toEqual(failure);
  });
});
