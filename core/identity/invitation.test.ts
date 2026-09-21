import { describe, expect, it, vi } from 'vitest';
import type { RepositoryPort } from '@/ports/repository';
import type { Notifier } from '@/ports/notifier';
import { err, ok } from '@/ports/result';
import type { InvitationToken, Tenant } from './types';
import { resendInvitation } from './invitation';

function fakeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    landlordId: 'landlord-1',
    name: 'Tenant One',
    email: 'tenant@example.com',
    phone: '+919876543210',
    invitationStatus: 'pending',
    authUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeInvitationToken(overrides: Partial<InvitationToken> = {}): InvitationToken {
  return {
    id: 'token-1',
    tenantId: 'tenant-1',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('resendInvitation', () => {
  it('is a no-op with a clear reason when the tenant already activated (I/O matrix)', async () => {
    const repository = {
      invalidatePendingInvitationTokens: vi.fn(),
      createInvitationToken: vi.fn(),
    } as unknown as RepositoryPort;
    const notifier = { sendEmail: vi.fn(), sendSms: vi.fn() } as unknown as Notifier;

    const result = await resendInvitation(
      { repository, notifier, appBaseUrl: 'https://example.com' },
      fakeTenant({ invitationStatus: 'active' }),
    );

    expect(result).toEqual(ok({ kind: 'already_active' }));
    expect(repository.invalidatePendingInvitationTokens).not.toHaveBeenCalled();
    expect(notifier.sendEmail).not.toHaveBeenCalled();
  });

  it('invalidates the old token, issues a new one, and emails it for a pending tenant', async () => {
    const invalidatePendingInvitationTokens = vi.fn(async () => ok(undefined));
    const createInvitationToken = vi.fn(async () => ok(fakeInvitationToken()));
    const sendEmail = vi.fn(async () => ok(undefined));

    const repository = {
      invalidatePendingInvitationTokens,
      createInvitationToken,
    } as unknown as RepositoryPort;
    const notifier = { sendEmail, sendSms: vi.fn() } as unknown as Notifier;

    const result = await resendInvitation(
      { repository, notifier, appBaseUrl: 'https://example.com' },
      fakeTenant({ invitationStatus: 'pending' }),
    );

    expect(result).toEqual(ok({ kind: 'sent' }));
    expect(createInvitationToken).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // Old token invalidated before the new one is created, which in turn
    // completes before the Notifier call fires (AD-1 ordering).
    const invalidateOrder = invalidatePendingInvitationTokens.mock.invocationCallOrder[0]!;
    const createOrder = createInvitationToken.mock.invocationCallOrder[0]!;
    const sendOrder = sendEmail.mock.invocationCallOrder[0]!;
    expect(invalidateOrder).toBeLessThan(createOrder);
    expect(createOrder).toBeLessThan(sendOrder);
  });

  it('propagates a repository failure without sending an email', async () => {
    const repository = {
      invalidatePendingInvitationTokens: vi.fn(async () => err({ code: 'DB_ERROR', message: 'boom' })),
      createInvitationToken: vi.fn(),
    } as unknown as RepositoryPort;
    const sendEmail = vi.fn();
    const notifier = { sendEmail, sendSms: vi.fn() } as unknown as Notifier;

    const result = await resendInvitation(
      { repository, notifier, appBaseUrl: 'https://example.com' },
      fakeTenant({ invitationStatus: 'pending' }),
    );

    expect(result.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
