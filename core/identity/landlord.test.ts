import { describe, expect, it, vi } from 'vitest';
import type { RepositoryPort } from '@/ports/repository';
import { err, ok } from '@/ports/result';
import type { Landlord } from './types';
import { resolveLandlordAccess } from './landlord';

const allowlist = { email: 'prasennavenkatesh@gmail.com', phone: null };

function fakeRepository(overrides: Partial<RepositoryPort> = {}): RepositoryPort {
  return {
    getLandlordByEmail: vi.fn(async () => ok(null)),
    createLandlord: vi.fn(async () => {
      throw new Error('not implemented in this fake');
    }),
    createTenantWithUnitAndLease: vi.fn(),
    getTenantById: vi.fn(),
    listTenantsByLandlord: vi.fn(),
    updateTenantContact: vi.fn(),
    invalidatePendingInvitationTokens: vi.fn(),
    createInvitationToken: vi.fn(),
    ...overrides,
  } as unknown as RepositoryPort;
}

describe('resolveLandlordAccess', () => {
  it('denies access when there is no authenticated identity', async () => {
    const repository = fakeRepository();
    const result = await resolveLandlordAccess(repository, null, allowlist);

    expect(result).toEqual(ok({ kind: 'denied' }));
    expect(repository.getLandlordByEmail).not.toHaveBeenCalled();
  });

  it('denies access when the identity is a real but non-allowlisted account (I/O matrix)', async () => {
    const repository = fakeRepository();
    const result = await resolveLandlordAccess(
      repository,
      { userId: 'u1', email: 'someone.else@gmail.com', emailVerified: true, phoneNumber: null, phoneNumberVerified: false },
      allowlist,
    );

    expect(result).toEqual(ok({ kind: 'denied' }));
    expect(repository.getLandlordByEmail).not.toHaveBeenCalled();
  });

  it('grants access and materializes the landlord row on first allowlisted sign-in', async () => {
    const created: Landlord = {
      id: 'landlord-1',
      email: allowlist.email,
      phone: null,
      name: 'Landlord',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const createLandlord = vi.fn(async () => ok(created));
    const repository = fakeRepository({
      getLandlordByEmail: vi.fn(async () => ok(null)),
      createLandlord,
    });

    const result = await resolveLandlordAccess(
      repository,
      { userId: 'u1', email: allowlist.email, emailVerified: true, phoneNumber: null, phoneNumberVerified: false },
      allowlist,
    );

    expect(result).toEqual(ok({ kind: 'granted', landlord: created }));
    expect(createLandlord).toHaveBeenCalledTimes(1);
  });

  it('re-fetches and grants access on a lost create-race instead of failing (no second landlord row)', async () => {
    const existing: Landlord = {
      id: 'landlord-1',
      email: allowlist.email,
      phone: null,
      name: 'Landlord',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const getLandlordByEmail = vi
      .fn()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(existing));
    const createLandlord = vi.fn(async () =>
      err({ code: 'ALREADY_EXISTS', message: 'A landlord with this email already exists.' }),
    );
    const repository = fakeRepository({ getLandlordByEmail, createLandlord });

    const result = await resolveLandlordAccess(
      repository,
      { userId: 'u1', email: allowlist.email, emailVerified: true, phoneNumber: null, phoneNumberVerified: false },
      allowlist,
    );

    expect(result).toEqual(ok({ kind: 'granted', landlord: existing }));
    expect(getLandlordByEmail).toHaveBeenCalledTimes(2);
  });

  it('grants access using the existing landlord row without creating a second one', async () => {
    const existing: Landlord = {
      id: 'landlord-1',
      email: allowlist.email,
      phone: null,
      name: 'Landlord',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const createLandlord = vi.fn();
    const repository = fakeRepository({
      getLandlordByEmail: vi.fn(async () => ok(existing)),
      createLandlord,
    });

    const result = await resolveLandlordAccess(
      repository,
      { userId: 'u1', email: allowlist.email, emailVerified: true, phoneNumber: null, phoneNumberVerified: false },
      allowlist,
    );

    expect(result).toEqual(ok({ kind: 'granted', landlord: existing }));
    expect(createLandlord).not.toHaveBeenCalled();
  });
});
