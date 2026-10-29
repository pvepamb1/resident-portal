import { describe, expect, it, vi } from 'vitest';
import type { RepositoryPort } from '@/ports/repository';
import type { EmailMessage, Notifier } from '@/ports/notifier';
import { err, ok } from '@/ports/result';
import type { NewTenantInput, Tenant, TenantWithLease } from './types';
import { addTenant, updateTenantContact } from './tenant';

function fakeTenantWithLease(): TenantWithLease {
  const now = new Date();
  return {
    tenant: {
      id: 'tenant-1',
      landlordId: 'landlord-1',
      name: 'Tenant One',
      email: 'tenant@example.com',
      phone: '+919876543210',
      invitationStatus: 'pending',
      authUserId: null,
      createdAt: now,
      updatedAt: now,
    },
    unit: { id: 'unit-1', landlordId: 'landlord-1', label: 'Flat 3B', createdAt: now, updatedAt: now },
    lease: {
      id: 'lease-1',
      unitId: 'unit-1',
      tenantId: 'tenant-1',
      startDate: now,
      endDate: null,
      rentAmountPaise: 5_000_000,
      status: 'active',
      endedAt: null,
      endedBy: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const validInput = {
  landlordId: 'landlord-1',
  name: 'Tenant One',
  email: 'Tenant@Example.com',
  phone: '9876543210',
  unitLabel: 'Flat 3B',
  leaseStartDate: new Date(),
  rentAmountPaise: 5_000_000,
};

describe('addTenant validation (I/O matrix: reject on bad format before persisting)', () => {
  it.each([
    ['name', { ...validInput, name: '   ' }],
    ['email', { ...validInput, email: 'not-an-email' }],
    ['phone', { ...validInput, phone: 'not-a-phone' }],
    ['unitLabel', { ...validInput, unitLabel: '' }],
    ['rentAmountPaise', { ...validInput, rentAmountPaise: 0 }],
  ])('rejects an invalid %s without touching the repository', async (field, input) => {
    const createTenantWithUnitAndLease = vi.fn();
    const repository = { createTenantWithUnitAndLease } as unknown as RepositoryPort;
    const notifier = { sendEmail: vi.fn(), sendSms: vi.fn() } as unknown as Notifier;

    const result = await addTenant({ repository, notifier, appBaseUrl: 'https://example.com' }, input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION');
      expect((result.error as { field: string }).field).toBe(field);
    }
    expect(createTenantWithUnitAndLease).not.toHaveBeenCalled();
  });
});

describe('addTenant success path', () => {
  it('normalizes identifiers, persists, and sends the invitation only after the write commits', async () => {
    const created = fakeTenantWithLease();
    const createTenantWithUnitAndLease = vi.fn(async (_input: NewTenantInput) => ok(created));
    const invalidatePendingInvitationTokens = vi.fn(async () => ok(undefined));
    const createInvitationToken = vi.fn(async () =>
      ok({
        id: 'invite-1',
        tenantId: created.tenant.id,
        tokenHash: 'hash',
        expiresAt: new Date(),
        usedAt: null,
        createdAt: new Date(),
      }),
    );
    const sendEmail = vi.fn(async (_message: EmailMessage) => ok(undefined));

    const repository = {
      createTenantWithUnitAndLease,
      invalidatePendingInvitationTokens,
      createInvitationToken,
    } as unknown as RepositoryPort;
    const notifier = { sendEmail, sendSms: vi.fn() } as unknown as Notifier;

    const result = await addTenant({ repository, notifier, appBaseUrl: 'https://example.com' }, validInput);

    expect(result).toEqual(ok(created));
    const persistedInput = createTenantWithUnitAndLease.mock.calls[0]?.[0];
    expect(persistedInput).toBeDefined();
    expect(persistedInput?.email).toBe('tenant@example.com');
    expect(persistedInput?.phone).toBe('+919876543210');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0].to).toBe(created.tenant.email);

    // The tenant/unit/lease write and the invitation-token write both
    // complete before the Notifier call fires (AD-1 ordering).
    const createTenantOrder = createTenantWithUnitAndLease.mock.invocationCallOrder[0]!;
    const issueTokenOrder = createInvitationToken.mock.invocationCallOrder[0]!;
    const sendOrder = sendEmail.mock.invocationCallOrder[0]!;
    expect(createTenantOrder).toBeLessThan(issueTokenOrder);
    expect(issueTokenOrder).toBeLessThan(sendOrder);
  });
});

describe('updateTenantContact (I/O matrix: update tenant contact info)', () => {
  it('normalizes and forwards only the provided fields', async () => {
    const updatedTenant: Tenant = {
      id: 'tenant-1',
      landlordId: 'landlord-1',
      name: 'New Name',
      email: 'new@example.com',
      phone: '+919876543210',
      invitationStatus: 'active',
      authUserId: 'auth-user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updateTenantContactMock = vi.fn(async () => ok(updatedTenant));
    const repository = { updateTenantContact: updateTenantContactMock } as unknown as RepositoryPort;

    const result = await updateTenantContact(repository, 'tenant-1', {
      email: 'New@Example.com',
      phone: '9876543210',
    });

    expect(result).toEqual(ok(updatedTenant));
    expect(updateTenantContactMock).toHaveBeenCalledWith('tenant-1', {
      email: 'new@example.com',
      phone: '+919876543210',
    });
  });

  it('rejects an invalid email without touching the repository', async () => {
    const updateTenantContactMock = vi.fn();
    const repository = { updateTenantContact: updateTenantContactMock } as unknown as RepositoryPort;

    const result = await updateTenantContact(repository, 'tenant-1', { email: 'not-an-email' });

    expect(result.ok).toBe(false);
    expect(updateTenantContactMock).not.toHaveBeenCalled();
  });

  it('never touches Better Auth session/account state -- only the on-file record', async () => {
    // updateTenantContact only ever calls RepositoryPort.updateTenantContact
    // (the tenants table). It has no dependency on the Auth port at all, so
    // an already-activated tenant's login identifier (Better Auth's own
    // user/account rows) cannot be affected by this call by construction.
    const updateTenantContactMock = vi.fn(async () =>
      ok({
        id: 'tenant-1',
        landlordId: 'landlord-1',
        name: 'Tenant One',
        email: 'updated@example.com',
        phone: '+919876543210',
        invitationStatus: 'active',
        authUserId: 'auth-user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const repository = { updateTenantContact: updateTenantContactMock } as unknown as RepositoryPort;

    const result = await updateTenantContact(repository, 'tenant-1', { email: 'updated@example.com' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authUserId).toBe('auth-user-1');
    }
  });

  it('surfaces LEASE_ENDED from the repository when the tenancy has ended', async () => {
    const repository = {
      updateTenantContact: vi.fn(async () => err({ code: 'LEASE_ENDED', message: 'Tenancy has ended.' })),
    } as unknown as RepositoryPort;

    const result = await updateTenantContact(repository, 'tenant-1', { name: 'Someone' });

    expect(result).toEqual(err({ code: 'LEASE_ENDED', message: 'Tenancy has ended.' }));
  });
});
