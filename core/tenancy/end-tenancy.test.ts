import { describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '@/ports/notifier';
import type { RepositoryPort } from '@/ports/repository';
import { err, ok, type PortError, type Result } from '@/ports/result';
import type { Lease, TenantWithLease } from '@/core/identity/types';
import type { TenancyExport } from './types';
import { ALREADY_ENDED_MESSAGE, endTenancy, parseMoveOutDate, sendTenancyExport, type TenancyDeps } from './end-tenancy';

// 2026-09-28 20:00 UTC = 2026-09-29 01:30 IST -- "today" in IST is the 29th.
const NOW = new Date('2026-09-28T20:00:00Z');

type Fail = Partial<Record<'endLease' | 'reserveExport' | 'put' | 'get' | 'markExportUploaded' | 'sendEmail' | 'markExportSent' | 'revoke' | 'payments', PortError>>;

/**
 * In-memory harness mirroring the adapters' contracts closely enough to
 * exercise ordering and idempotency: `endLease` flips active->ended once,
 * `reserveExport` converges on one row, storage is a key->bytes map.
 */
function harness(opts: { authUserId?: string | null; landlordId?: string; status?: Lease['status']; fail?: Fail } = {}) {
  const fail = opts.fail ?? {};
  const calls: string[] = [];
  const now = new Date('2026-01-01T00:00:00Z');
  const state: {
    tenancy: TenantWithLease;
    sessionsDeleted: number;
    tokensInvalidated: number;
    exportRow: TenancyExport | null;
    objects: Map<string, Uint8Array>;
    emails: EmailMessage[];
    reserveCount: number;
  } = {
    tenancy: {
      tenant: {
        id: 'tenant-1',
        landlordId: opts.landlordId ?? 'landlord-1',
        name: 'Tenant <One>',
        email: 'tenant@example.com',
        phone: '+919876543210',
        invitationStatus: opts.authUserId ? 'active' : 'pending',
        authUserId: opts.authUserId ?? null,
        createdAt: now,
        updatedAt: now,
      },
      unit: { id: 'unit-1', landlordId: 'landlord-1', label: 'Flat 3B', createdAt: now, updatedAt: now },
      lease: {
        id: 'lease-1',
        unitId: 'unit-1',
        tenantId: 'tenant-1',
        startDate: new Date(Date.UTC(2025, 0, 1)),
        endDate: new Date(Date.UTC(2027, 0, 1)),
        rentAmountPaise: 1_250_000,
        status: opts.status ?? 'active',
        endedAt: null,
        endedBy: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    sessionsDeleted: 0,
    tokensInvalidated: 0,
    exportRow: null,
    objects: new Map(),
    emails: [],
    reserveCount: 0,
  };

  const repository = {
    getTenantById: vi.fn(async (id: string) => {
      calls.push('getTenantById');
      return ok(id === state.tenancy.tenant.id ? structuredClone(state.tenancy) : null);
    }),
    endLease: vi.fn(async (input: Parameters<RepositoryPort['endLease']>[0]) => {
      calls.push('endLease');
      if (fail.endLease) return err(fail.endLease);
      // Atomic: all-or-nothing, and the revoke re-runs even when already ended.
      state.tokensInvalidated += 1;
      // Sessions are keyed on the tenant's *current* auth user, resolved in the batch.
      if (state.tenancy.tenant.authUserId) state.sessionsDeleted += 1;
      if (state.tenancy.lease.status === 'active') {
        state.tenancy.lease = {
          ...state.tenancy.lease,
          status: 'ended',
          endDate: input.endDate,
          endedAt: new Date(),
          endedBy: input.endedBy,
        };
        return ok({ outcome: 'ended' as const, lease: structuredClone(state.tenancy.lease) });
      }
      return ok({ outcome: 'already_ended' as const, lease: structuredClone(state.tenancy.lease) });
    }),
    reserveExport: vi.fn(async (leaseId: string) => {
      calls.push('reserveExport');
      if (fail.reserveExport) return err(fail.reserveExport);
      state.reserveCount += 1;
      state.exportRow ??= {
        id: 'export-1',
        leaseId,
        objectKey: `tenancy-exports/${'a'.repeat(32)}.csv`,
        generatedAt: new Date('2026-09-28T20:00:00.123Z'),
        uploadedAt: null,
        lastSentAt: null,
      };
      return ok({ ...state.exportRow });
    }),
    markExportUploaded: vi.fn(async () => {
      calls.push('markExportUploaded');
      if (fail.markExportUploaded) return err(fail.markExportUploaded);
      if (state.exportRow && !state.exportRow.uploadedAt) state.exportRow.uploadedAt = new Date();
      return ok(undefined);
    }),
    markExportSent: vi.fn(async () => {
      calls.push('markExportSent');
      if (fail.markExportSent) return err(fail.markExportSent);
      if (state.exportRow) state.exportRow.lastSentAt = new Date();
      return ok(undefined);
    }),
  } as unknown as RepositoryPort;

  const logger = { error: vi.fn() };

  const deps: TenancyDeps = {
    repository,
    auth: {
      revokeAllSessionsForUser: vi.fn(async (): Promise<Result<void>> => {
        calls.push('revoke');
        if (fail.revoke) return err(fail.revoke);
        state.sessionsDeleted += 1;
        return ok(undefined);
      }),
    },
    storage: {
      put: vi.fn(async ({ key, body }) => {
        calls.push('put');
        if (fail.put) return err(fail.put);
        state.objects.set(key, new Uint8Array(body));
        return ok(undefined);
      }),
      get: vi.fn(async (key: string) => {
        calls.push('get');
        if (fail.get) return err(fail.get);
        const object = state.objects.get(key);
        return object ? ok(new Uint8Array(object)) : err({ code: 'NOT_FOUND', message: 'missing' });
      }),
    },
    paymentHistory: {
      listForLease: vi.fn(async () => {
        calls.push('payments');
        if (fail.payments) return err(fail.payments);
        return ok([]);
      }),
    },
    notifier: {
      sendEmail: vi.fn(async (message: EmailMessage) => {
        calls.push('sendEmail');
        if (fail.sendEmail) return err(fail.sendEmail);
        state.emails.push(message);
        return ok(undefined);
      }),
      sendSms: vi.fn(),
    },
    logger,
    now: () => NOW,
  };

  return { deps, state, calls, logger, fail };
}

const boom: PortError = { code: 'BOOM', message: 'boom' };
const endInput = { tenantId: 'tenant-1', landlordId: 'landlord-1', actingUserId: 'landlord-user' };

describe('parseMoveOutDate', () => {
  it('defaults to today in IST', () => {
    expect(parseMoveOutDate('', NOW)).toEqual(ok(new Date(Date.UTC(2026, 8, 29))));
  });
  it('allows today (IST) and past dates', () => {
    expect(parseMoveOutDate('2026-09-29', NOW).ok).toBe(true);
    expect(parseMoveOutDate('2020-02-29', NOW)).toEqual(ok(new Date(Date.UTC(2020, 1, 29))));
  });
  it.each(['2026-09-30', '2027-01-01'])('rejects the future date %s', (value) => {
    const result = parseMoveOutDate(value, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'VALIDATION', field: 'endDate' });
  });
  it.each(['not-a-date', '2026-02-30', '2026-13-01', '29/09/2026'])('rejects the unparseable %s', (value) => {
    const result = parseMoveOutDate(value, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'VALIDATION', field: 'endDate' });
  });
});

describe('endTenancy (I/O matrix)', () => {
  it('activated tenant: ends lease + revokes in one batch, stores the snapshot, then emails it', async () => {
    const h = harness({ authUserId: 'tenant-user' });

    const result = await endTenancy(h.deps, { ...endInput, endDate: '2026-09-15' });

    expect(result).toEqual(ok({ kind: 'ended' }));
    expect(h.deps.repository.endLease).toHaveBeenCalledWith({
      leaseId: 'lease-1',
      endDate: new Date(Date.UTC(2026, 8, 15)),
      endedBy: 'landlord-1',
    });
    expect(h.state.tenancy.lease.status).toBe('ended');
    expect(h.state.sessionsDeleted).toBe(1);
    expect(h.calls).toEqual([
      'getTenantById',
      'endLease',
      'reserveExport',
      'payments',
      'put',
      'markExportUploaded',
      'sendEmail',
      'markExportSent',
    ]);
    expect(h.state.objects.size).toBe(1);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.exportRow?.lastSentAt).not.toBeNull();
  });

  it('never-activated tenant: same flow with no session to delete', async () => {
    const h = harness({ authUserId: null });

    const result = await endTenancy(h.deps, endInput);

    expect(result).toEqual(ok({ kind: 'ended' }));
    expect(h.state.tokensInvalidated).toBe(1);
    expect(h.state.sessionsDeleted).toBe(0);
    expect(h.deps.auth.revokeAllSessionsForUser).not.toHaveBeenCalled();
    expect(h.state.emails).toHaveLength(1);
  });

  it('email carries the stored CSV as an attachment, byte-identical, and no link', async () => {
    const h = harness({ authUserId: 'tenant-user' });
    await endTenancy(h.deps, endInput);

    const email = h.state.emails[0]!;
    expect(email.to).toBe('tenant@example.com');
    expect(email.attachments).toHaveLength(1);
    const attachment = email.attachments![0]!;
    expect(attachment.filename).toBe('tenancy-payment-history.csv');
    expect(attachment.contentType).toBe('text/csv');
    const stored = h.state.objects.get(h.state.exportRow!.objectKey)!;
    expect(Buffer.compare(Buffer.from(attachment.content), Buffer.from(stored))).toBe(0);
    expect(email.html).not.toMatch(/href=|https?:\/\//);
    // Tenant-supplied text is escaped.
    expect(email.html).toContain('Tenant &lt;One&gt;');
    // The CSV uses the reserved row's generatedAt and the stored move-out date.
    expect(Buffer.from(stored).toString('utf8')).toContain('Generated at,2026-09-29T01:30:00+05:30');
    expect(Buffer.from(stored).toString('utf8')).toContain('Lease end,2026-09-29');
  });

  it('already ended: re-runs the revoke, no second transition, no email, points to Send export', async () => {
    const h = harness({ authUserId: 'tenant-user', status: 'ended' });

    const result = await endTenancy(h.deps, endInput);

    expect(result).toEqual(ok({ kind: 'already_ended' }));
    expect(h.deps.auth.revokeAllSessionsForUser).toHaveBeenCalledWith('tenant-user');
    expect(h.deps.repository.reserveExport).not.toHaveBeenCalled();
    expect(h.deps.notifier.sendEmail).not.toHaveBeenCalled();
    expect(ALREADY_ENDED_MESSAGE).toContain('Send export');
  });

  it('double submit: exactly one transition and one email', async () => {
    const h = harness({ authUserId: 'tenant-user' });

    const [first, second] = await Promise.all([endTenancy(h.deps, endInput), endTenancy(h.deps, endInput)]);

    const kinds = [first, second].map((r) => (r.ok ? r.value.kind : r.error.code)).sort();
    expect(kinds).toEqual(['already_ended', 'ended']);
    expect(h.deps.notifier.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.state.objects.size).toBe(1);
  });

  it('end batch fails: nothing changes, nothing is sent, error returned', async () => {
    const h = harness({ authUserId: 'tenant-user', fail: { endLease: boom } });

    const result = await endTenancy(h.deps, endInput);

    expect(result).toEqual(err(boom));
    expect(h.state.tenancy.lease.status).toBe('active');
    expect(h.state.sessionsDeleted).toBe(0);
    expect(h.deps.repository.reserveExport).not.toHaveBeenCalled();
    expect(h.deps.notifier.sendEmail).not.toHaveBeenCalled();
  });

  it.each(['reserveExport', 'payments', 'put', 'markExportUploaded', 'sendEmail'] as const)(
    '%s fails after End: lease stays ended, access stays revoked, error points to Send export',
    async (step) => {
      const h = harness({ authUserId: 'tenant-user', fail: { [step]: boom } });

      const result = await endTenancy(h.deps, endInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXPORT_DELIVERY_FAILED');
        expect(result.error.message).toContain('Send export');
      }
      expect(h.state.tenancy.lease.status).toBe('ended');
      expect(h.state.sessionsDeleted).toBe(1);
      // Logged with lease id + failing code only -- no CSV content.
      expect(h.logger.error).toHaveBeenCalledWith('tenancy_export.delivery_failed', { leaseId: 'lease-1', code: 'BOOM' });
      expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain('Tenant name');
    },
  );

  it('notifier failure, then Send export reuses the reserved snapshot row and object', async () => {
    const h = harness({ authUserId: 'tenant-user', fail: { sendEmail: boom } });
    await endTenancy(h.deps, endInput);
    const firstKey = h.state.exportRow!.objectKey;
    const firstBytes = h.state.objects.get(firstKey)!;

    delete h.fail.sendEmail;
    const resent = await sendTenancyExport(h.deps, endInput);

    expect(resent).toEqual(ok({ kind: 'sent' }));
    expect(h.state.objects.size).toBe(1);
    expect(h.state.exportRow!.objectKey).toBe(firstKey);
    expect(h.deps.storage.put).toHaveBeenCalledTimes(1);
    expect(h.deps.storage.get).toHaveBeenCalledTimes(1);
    const attachment = h.state.emails[0]!.attachments![0]!;
    expect(Buffer.compare(Buffer.from(attachment.content), Buffer.from(firstBytes))).toBe(0);
  });

  it('upload never recorded (crash after put): retry re-puts identical bytes to the same key', async () => {
    const h = harness({ authUserId: null, fail: { markExportUploaded: boom } });
    await endTenancy(h.deps, endInput);
    const firstBytes = h.state.objects.get(h.state.exportRow!.objectKey)!;

    delete h.fail.markExportUploaded;
    await sendTenancyExport(h.deps, endInput);

    expect(h.state.objects.size).toBe(1);
    expect(Buffer.compare(Buffer.from(h.state.objects.get(h.state.exportRow!.objectKey)!), Buffer.from(firstBytes))).toBe(0);
  });

  it('email accepted but markExportSent fails: reported as success, failure logged without CSV content', async () => {
    const h = harness({ authUserId: 'tenant-user', fail: { markExportSent: boom } });

    const result = await endTenancy(h.deps, endInput);

    expect(result).toEqual(ok({ kind: 'ended' }));
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(h.logger.error.mock.calls);
    expect(logged).not.toContain('Tenant name');
    expect(logged).not.toContain('Tenant <One>');
  });

  it.each([
    ['future', '2099-01-01'],
    ['unparseable', 'garbage'],
  ])('%s move-out date: nothing changes, validation error on the date field', async (_label, endDate) => {
    const h = harness({ authUserId: 'tenant-user' });

    const result = await endTenancy(h.deps, { ...endInput, endDate });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'VALIDATION', field: 'endDate' });
    expect(h.deps.repository.endLease).not.toHaveBeenCalled();
  });

  it('move-out date before the lease start (IST): nothing changes, validation error on the date field', async () => {
    const h = harness({ authUserId: 'tenant-user' });

    // Lease starts 2025-01-01 (IST); 2024-12-31 is one calendar day earlier.
    const result = await endTenancy(h.deps, { ...endInput, endDate: '2024-12-31' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'VALIDATION', field: 'endDate' });
    expect(h.deps.repository.endLease).not.toHaveBeenCalled();
    // Same day as the start is fine.
    expect((await endTenancy(h.deps, { ...endInput, endDate: '2025-01-01' })).ok).toBe(true);
  });

  it("refuses when the tenant is linked to the acting landlord's own login", async () => {
    const h = harness({ authUserId: 'landlord-user' });

    const result = await endTenancy(h.deps, endInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELF_REVOKE_REFUSED');
    expect(h.deps.repository.endLease).not.toHaveBeenCalled();
    expect(h.deps.auth.revokeAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("refuses another landlord's tenant exactly like a missing one", async () => {
    const h = harness({ authUserId: 'tenant-user', landlordId: 'someone-else' });

    const result = await endTenancy(h.deps, endInput);

    expect(result).toEqual(err({ code: 'NOT_FOUND', message: 'Tenant not found.' }));
    expect(h.deps.repository.endLease).not.toHaveBeenCalled();
  });
});

describe('sendTenancyExport', () => {
  it('requires an ended lease', async () => {
    const h = harness({ authUserId: 'tenant-user' });

    const result = await sendTenancyExport(h.deps, endInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_ENDED');
    expect(h.deps.notifier.sendEmail).not.toHaveBeenCalled();
  });

  it('re-runs the revoke before re-sending the same stored snapshot (no second object)', async () => {
    const h = harness({ authUserId: 'tenant-user' });
    await endTenancy(h.deps, endInput);

    const result = await sendTenancyExport(h.deps, endInput);

    expect(result).toEqual(ok({ kind: 'sent' }));
    expect(h.state.objects.size).toBe(1);
    expect(h.deps.storage.put).toHaveBeenCalledTimes(1);
    const revokeOrder = vi.mocked(h.deps.auth.revokeAllSessionsForUser).mock.invocationCallOrder[0]!;
    const getOrder = vi.mocked(h.deps.storage.get).mock.invocationCallOrder[0]!;
    expect(revokeOrder).toBeLessThan(getOrder);
    const [a, b] = h.state.emails.map((e) => Buffer.from(e.attachments![0]!.content));
    expect(Buffer.compare(a!, b!)).toBe(0);
  });

  it('racing End: both converge on one object referenced by the export row', async () => {
    const h = harness({ authUserId: 'tenant-user' });
    // Send export can only proceed once End's batch committed, so start it right after.
    const end = endTenancy(h.deps, endInput);
    await Promise.resolve();
    const send = sendTenancyExport(h.deps, endInput);
    await Promise.all([end, send]);

    expect(h.state.objects.size).toBe(1);
    expect([...h.state.objects.keys()]).toEqual([h.state.exportRow!.objectKey]);
  });

  it('logs a delivery failure (lease id + code only) and returns it', async () => {
    const h = harness({ authUserId: null, status: 'ended', fail: { put: boom } });

    const result = await sendTenancyExport(h.deps, endInput);

    expect(result).toEqual(err(boom));
    expect(h.logger.error).toHaveBeenCalledWith('tenancy_export.delivery_failed', { leaseId: 'lease-1', code: 'BOOM' });
  });

  it('surfaces a revoke failure without sending', async () => {
    const h = harness({ authUserId: 'tenant-user', status: 'ended', fail: { revoke: boom } });

    const result = await sendTenancyExport(h.deps, endInput);

    expect(result).toEqual(err(boom));
    expect(h.deps.notifier.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses another landlord's tenant", async () => {
    const h = harness({ status: 'ended', landlordId: 'someone-else' });
    expect((await sendTenancyExport(h.deps, endInput)).ok).toBe(false);
    expect(h.deps.notifier.sendEmail).not.toHaveBeenCalled();
  });
});
