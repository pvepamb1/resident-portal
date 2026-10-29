import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * DB-backed race tests for CAP-8 against a real Postgres (the Neon `test`
 * branch). Skipped when TEST_DATABASE_URL is unset. Read from the process
 * env first, then from .env.local (only that one variable -- DATABASE_URL
 * is never picked up here, so these writes can't hit the dev database).
 * Requires the branch to be migrated (`DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate`).
 */
function loadTestDatabaseUrl(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    return parse(readFileSync(new URL('../../.env.local', import.meta.url))).TEST_DATABASE_URL || undefined;
  } catch {
    return undefined;
  }
}

const testDatabaseUrl = loadTestDatabaseUrl();

describe.skipIf(!testDatabaseUrl)('drizzleRepository CAP-8 races (real Postgres)', () => {
  let repo: typeof import('./repository').drizzleRepository;
  let db: typeof import('@/db').db;
  let schema: typeof import('@/db/schema');
  let authSchema: typeof import('@/db/auth-schema');
  let orm: typeof import('drizzle-orm');
  let resolveTenantAccess: typeof import('@/core/tenancy/access').resolveTenantAccess;
  let landlordId: string;
  const authUserIds: string[] = [];

  beforeAll(async () => {
    // Point the shared `db` module at the test branch before it is first imported.
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ drizzleRepository: repo } = await import('./repository'));
    ({ db } = await import('@/db'));
    schema = await import('@/db/schema');
    authSchema = await import('@/db/auth-schema');
    orm = await import('drizzle-orm');
    ({ resolveTenantAccess } = await import('@/core/tenancy/access'));

    const landlord = await repo.createLandlord({ email: `race-${randomUUID()}@test.invalid`, name: 'Race Landlord' });
    if (!landlord.ok) throw new Error(landlord.error.message);
    landlordId = landlord.value.id;
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    if (landlordId) {
      // Tenants first (cascading to leases, tokens and exports): `leases.ended_by`
      // deliberately blocks deleting a landlord who still has ended leases.
      await db.delete(schema.tenants).where(orm.eq(schema.tenants.landlordId, landlordId));
      await db.delete(schema.landlords).where(orm.eq(schema.landlords.id, landlordId));
    }
    if (authUserIds.length) await db.delete(authSchema.user).where(orm.inArray(authSchema.user.id, authUserIds));
  }, 30_000);

  async function seedTenancy(opts: { withUser?: boolean } = {}) {
    const created = await repo.createTenantWithUnitAndLease({
      landlordId,
      name: 'Race Tenant',
      email: `tenant-${randomUUID()}@test.invalid`,
      phone: '+919876543210',
      unitLabel: 'Flat R',
      leaseStartDate: new Date(Date.UTC(2025, 0, 1)),
      rentAmountPaise: 1_000_000,
    });
    if (!created.ok) throw new Error(created.error.message);
    let authUserId: string | null = null;
    if (opts.withUser) {
      authUserId = `race-user-${randomUUID()}`;
      authUserIds.push(authUserId);
      await db.insert(authSchema.user).values({ id: authUserId, name: 'Race', email: `${authUserId}@test.invalid` });
      await db.insert(authSchema.session).values(
        [1, 2].map(() => ({
          id: randomUUID(),
          userId: authUserId!,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000),
        })),
      );
      await db
        .update(schema.tenants)
        .set({ authUserId, invitationStatus: 'active' })
        .where(orm.eq(schema.tenants.id, created.value.tenant.id));
    }
    return { ...created.value, authUserId };
  }

  async function validTokenCount(tenantId: string) {
    const rows = await db
      .select()
      .from(schema.invitationTokens)
      .where(orm.and(orm.eq(schema.invitationTokens.tenantId, tenantId), orm.isNull(schema.invitationTokens.usedAt)));
    return rows.length;
  }

  it('endLease atomically ends the lease, invalidates tokens and deletes every session; re-run is already_ended', async () => {
    const t = await seedTenancy({ withUser: true });
    const token = await repo.createInvitationToken({ tenantId: t.tenant.id, tokenHash: 'h1', expiresAt: new Date(Date.now() + 1e6) });
    expect(token.ok).toBe(true);

    const endDate = new Date(Date.UTC(2026, 8, 1));
    const first = await repo.endLease({ leaseId: t.lease.id, endDate, endedBy: landlordId });
    expect(first.ok && first.value.outcome).toBe('ended');
    if (first.ok) {
      expect(first.value.lease).toMatchObject({ status: 'ended', endDate, endedBy: landlordId });
      expect(first.value.lease.endedAt).toBeInstanceOf(Date);
    }
    const sessions = await db.select().from(authSchema.session).where(orm.eq(authSchema.session.userId, t.authUserId!));
    expect(sessions).toHaveLength(0);
    expect(await validTokenCount(t.tenant.id)).toBe(0);

    const again = await repo.endLease({ leaseId: t.lease.id, endDate: new Date(), endedBy: landlordId });
    expect(again.ok && again.value.outcome).toBe('already_ended');
    // The first transition's move-out date is kept.
    if (again.ok) expect(again.value.lease.endDate).toEqual(endDate);

    const access = await resolveTenantAccess(repo, t.authUserId!);
    expect(access.ok && access.value.kind).toBe('revoked');

    const edit = await repo.updateTenantContact(t.tenant.id, { name: 'Changed' });
    expect(!edit.ok && edit.error.code).toBe('LEASE_ENDED');
    const resend = await repo.createInvitationToken({ tenantId: t.tenant.id, tokenHash: 'h2', expiresAt: new Date(Date.now() + 1e6) });
    expect(!resend.ok && resend.error.code).toBe('LEASE_ENDED');
  }, 30_000);

  it('endLease on a missing lease deletes nothing and reports NOT_FOUND', async () => {
    const t = await seedTenancy({ withUser: true });
    const missing = await repo.endLease({ leaseId: randomUUID(), endDate: new Date(), endedBy: landlordId });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    const sessions = await db.select().from(authSchema.session).where(orm.eq(authSchema.session.userId, t.authUserId!));
    expect(sessions).toHaveLength(2);
  }, 30_000);

  it('concurrent endLease calls: exactly one transition', async () => {
    const t = await seedTenancy({ withUser: true });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        repo.endLease({ leaseId: t.lease.id, endDate: new Date(), endedBy: landlordId }),
      ),
    );
    const outcomes = results.map((r) => (r.ok ? r.value.outcome : r.error.code));
    expect(outcomes.filter((o) => o === 'ended')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'already_ended')).toHaveLength(3);
  }, 30_000);

  it('concurrent endLease + createInvitationToken: no valid token exists afterwards', async () => {
    for (let i = 0; i < 5; i += 1) {
      const t = await seedTenancy();
      const [ended] = await Promise.all([
        repo.endLease({ leaseId: t.lease.id, endDate: new Date(), endedBy: landlordId }),
        repo.createInvitationToken({ tenantId: t.tenant.id, tokenHash: `race-${i}`, expiresAt: new Date(Date.now() + 1e6) }),
        repo.createInvitationToken({ tenantId: t.tenant.id, tokenHash: `race-${i}b`, expiresAt: new Date(Date.now() + 1e6) }),
      ]);
      expect(ended.ok).toBe(true);
      expect(await validTokenCount(t.tenant.id)).toBe(0);
    }
  }, 60_000);

  it('concurrent reserveExport: every caller converges on one row and key', async () => {
    const t = await seedTenancy();
    await repo.endLease({ leaseId: t.lease.id, endDate: new Date(), endedBy: landlordId });

    const results = await Promise.all(Array.from({ length: 6 }, () => repo.reserveExport(t.lease.id)));

    const rows = results.map((r) => {
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    });
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(new Set(rows.map((r) => r.objectKey)).size).toBe(1);
    expect(new Set(rows.map((r) => r.generatedAt.getTime())).size).toBe(1);
    expect(rows[0]!.objectKey).toMatch(/^tenancy-exports\/[0-9a-f]{32}\.csv$/);
    expect(rows[0]!.uploadedAt).toBeNull();

    const stored = await db.select().from(schema.tenancyExports).where(orm.eq(schema.tenancyExports.leaseId, t.lease.id));
    expect(stored).toHaveLength(1);

    expect((await repo.markExportUploaded(rows[0]!.id)).ok).toBe(true);
    expect((await repo.markExportSent(rows[0]!.id)).ok).toBe(true);
    const after = await repo.reserveExport(t.lease.id);
    expect(after.ok && after.value.uploadedAt).toBeInstanceOf(Date);
    expect(after.ok && after.value.lastSentAt).toBeInstanceOf(Date);
    expect(after.ok && after.value.objectKey).toBe(rows[0]!.objectKey);
  }, 30_000);
});
