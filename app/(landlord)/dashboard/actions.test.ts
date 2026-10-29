import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireLandlord: vi.fn(),
  requireLandlordSession: vi.fn(),
  repository: {
    getTenantById: vi.fn(),
    updateTenantContact: vi.fn(),
    invalidatePendingInvitationTokens: vi.fn(),
    createInvitationToken: vi.fn(),
  },
  sendEmail: vi.fn(),
  endTenancy: vi.fn(),
  sendTenancyExport: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('./require-landlord', () => ({
  requireLandlord: m.requireLandlord,
  requireLandlordSession: m.requireLandlordSession,
}));
vi.mock('@/adapters/db/repository', () => ({ drizzleRepository: m.repository }));
vi.mock('@/adapters/notify', () => ({
  createNotifierFromEnv: () => ({ sendEmail: m.sendEmail, sendSms: vi.fn() }),
}));
vi.mock('@/adapters/auth/auth-port', () => ({ authPort: { revokeAllSessionsForUser: vi.fn() } }));
vi.mock('@/adapters/db/r2-object-storage', () => ({ createR2ObjectStorageFromEnv: () => ({ put: vi.fn(), get: vi.fn() }) }));
vi.mock('@/adapters/db/empty-payment-history', () => ({ emptyPaymentHistoryReader: { listForLease: vi.fn() } }));
vi.mock('@/core/tenancy/end-tenancy', () => ({ endTenancy: m.endTenancy, sendTenancyExport: m.sendTenancyExport }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));

const actions = await import('./actions');

const LANDLORD = { id: 'landlord-row-id', email: 'l@example.com', phone: null, name: 'L', createdAt: new Date(), updatedAt: new Date() };
const AUTH_USER_ID = 'better-auth-user-id';

function foreignTenancy() {
  const now = new Date();
  return {
    tenant: {
      id: 'tenant-1',
      landlordId: 'someone-else',
      name: 'T',
      email: 't@example.com',
      phone: '+919876543210',
      invitationStatus: 'pending',
      authUserId: null,
      createdAt: now,
      updatedAt: now,
    },
    unit: { id: 'u', landlordId: 'someone-else', label: 'U', createdAt: now, updatedAt: now },
    lease: {
      id: 'lease-1',
      unitId: 'u',
      tenantId: 'tenant-1',
      startDate: now,
      endDate: null,
      rentAmountPaise: 100,
      status: 'active',
      endedAt: null,
      endedBy: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireLandlord.mockResolvedValue(LANDLORD);
  m.requireLandlordSession.mockResolvedValue({ landlord: LANDLORD, authUserId: AUTH_USER_ID });
  m.repository.getTenantById.mockResolvedValue({ ok: true, value: foreignTenancy() });
});

describe('ownership checks', () => {
  it("resendInvitationAction: another landlord's tenant gets 'Tenant not found.' with no write and no email", async () => {
    const result = await actions.resendInvitationAction('tenant-1');

    expect(result).toEqual({ status: 'error', message: 'Tenant not found.' });
    expect(m.repository.invalidatePendingInvitationTokens).not.toHaveBeenCalled();
    expect(m.repository.createInvitationToken).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("updateTenantContactAction: another landlord's tenant gets 'Tenant not found.' with no write", async () => {
    const form = new FormData();
    form.set('name', 'Hijacked');

    const result = await actions.updateTenantContactAction('tenant-1', { status: 'idle' }, form);

    expect(result).toEqual({ status: 'error', message: 'Tenant not found.' });
    expect(m.repository.updateTenantContact).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
});

describe('acting user id', () => {
  it("endTenancyAction passes the session's Better Auth user id (not landlord.id) as actingUserId", async () => {
    m.endTenancy.mockResolvedValue({ ok: false, error: { code: 'SELF_REVOKE_REFUSED', message: 'no' } });
    const form = new FormData();
    form.set('endDate', '2026-09-01');

    const result = await actions.endTenancyAction('tenant-1', { status: 'idle' }, form);

    expect(m.endTenancy).toHaveBeenCalledTimes(1);
    expect(m.endTenancy.mock.calls[0]![1]).toEqual({
      tenantId: 'tenant-1',
      landlordId: LANDLORD.id,
      actingUserId: AUTH_USER_ID,
      endDate: '2026-09-01',
    });
    // Self-revoke refusal stays inline (no redirect).
    expect(result).toEqual({ status: 'error', message: 'no' });
    expect(m.redirect).not.toHaveBeenCalled();
  });

  it("sendTenancyExportAction passes the session's Better Auth user id as actingUserId", async () => {
    m.sendTenancyExport.mockResolvedValue({ ok: true, value: { kind: 'sent' } });

    await actions.sendTenancyExportAction('tenant-1');

    expect(m.sendTenancyExport.mock.calls[0]![1]).toEqual({
      tenantId: 'tenant-1',
      landlordId: LANDLORD.id,
      actingUserId: AUTH_USER_ID,
    });
  });
});

describe('endTenancyAction outcome routing', () => {
  it.each([
    [{ ok: true, value: { kind: 'ended' } }, 'tenancy_ended'],
    [{ ok: true, value: { kind: 'already_ended' } }, 'tenancy_already_ended'],
    [{ ok: false, error: { code: 'EXPORT_DELIVERY_FAILED', message: 'x' } }, 'export_delivery_failed'],
  ])('redirects to a dashboard notice once the lease is ended (%j)', async (outcome, notice) => {
    m.endTenancy.mockResolvedValue(outcome);

    await expect(actions.endTenancyAction('tenant-1', { status: 'idle' }, new FormData())).rejects.toThrow(
      `NEXT_REDIRECT:/dashboard?notice=${notice}`,
    );
  });

  it('keeps validation errors inline on the date field', async () => {
    m.endTenancy.mockResolvedValue({ ok: false, error: { code: 'VALIDATION', field: 'endDate', message: 'bad' } });

    const result = await actions.endTenancyAction('tenant-1', { status: 'idle' }, new FormData());

    expect(result).toEqual({ status: 'error', message: 'bad', field: 'endDate' });
    expect(m.redirect).not.toHaveBeenCalled();
  });
});
