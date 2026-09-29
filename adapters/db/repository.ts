import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session as authSession } from '@/db/auth-schema';
import { invitationTokens, leases, tenancyExports, tenants, units, landlords } from '@/db/schema';
import type {
  InvitationToken,
  Landlord,
  NewLandlordInput,
  NewTenantInput,
  Tenant,
  TenantContactPatch,
  TenantWithLease,
  Unit,
  Lease,
} from '@/core/identity/types';
import type { TenancyExport } from '@/core/tenancy/types';
import type { RepositoryPort } from '@/ports/repository';
import { err, ok, type Result } from '@/ports/result';

/**
 * Drizzle-backed RepositoryPort implementation (AD-1). Every method catches
 * its own driver/DB errors and returns a `PortError` -- nothing throws
 * across the port boundary.
 *
 * Note on atomicity: the neon-http driver has no interactive
 * (BEGIN/COMMIT-across-round-trips) transaction support, since each query
 * is its own HTTP request. `createTenantWithUnitAndLease` instead
 * pre-generates the three rows' UUIDv7 ids via Postgres, then writes all
 * three rows in one `db.batch(...)` call, which Neon executes as a single
 * atomic server-side transaction over one HTTP round trip.
 */

async function generateUuidV7s(count: number): Promise<string[]> {
  const result = await db.execute<{ id: string }>(
    sql`select uuidv7() as id from generate_series(1, ${count})`,
  );
  return result.rows.map((row) => row.id);
}

function toLandlord(row: typeof landlords.$inferSelect): Landlord {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTenant(row: typeof tenants.$inferSelect): Tenant {
  return {
    id: row.id,
    landlordId: row.landlordId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    invitationStatus: row.invitationStatus,
    authUserId: row.authUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUnit(row: typeof units.$inferSelect): Unit {
  return {
    id: row.id,
    landlordId: row.landlordId,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLease(row: typeof leases.$inferSelect): Lease {
  return {
    id: row.id,
    unitId: row.unitId,
    tenantId: row.tenantId,
    startDate: row.startDate,
    endDate: row.endDate,
    rentAmountPaise: row.rentAmountPaise,
    status: row.status,
    endedAt: row.endedAt,
    endedBy: row.endedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toInvitationToken(row: typeof invitationTokens.$inferSelect): InvitationToken {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

function toTenancyExport(row: typeof tenancyExports.$inferSelect): TenancyExport {
  return {
    id: row.id,
    leaseId: row.leaseId,
    objectKey: row.objectKey,
    generatedAt: row.generatedAt,
    uploadedAt: row.uploadedAt,
    lastSentAt: row.lastSentAt,
  };
}

/** Raw-SQL rows come back snake_cased; timestamps may arrive as strings. */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/** Postgres error code 23505 = unique_violation. */
function isUniqueViolation(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505';
}

function toPortError(cause: unknown, fallbackMessage: string) {
  return {
    code: 'DB_ERROR',
    message: cause instanceof Error ? cause.message : fallbackMessage,
    cause,
  };
}

export const drizzleRepository: RepositoryPort = {
  async getLandlordByEmail(email): Promise<Result<Landlord | null>> {
    try {
      const rows = await db.select().from(landlords).where(eq(landlords.email, email)).limit(1);
      return ok(rows[0] ? toLandlord(rows[0]) : null);
    } catch (cause) {
      return err(toPortError(cause, 'Failed to look up landlord.'));
    }
  },

  async createLandlord(input: NewLandlordInput): Promise<Result<Landlord>> {
    try {
      const [id] = await generateUuidV7s(1);
      const rows = await db
        .insert(landlords)
        .values({ id, email: input.email, phone: input.phone ?? null, name: input.name })
        .returning();
      const row = rows[0];
      if (!row) return err({ code: 'DB_ERROR', message: 'Insert returned no row.' });
      return ok(toLandlord(row));
    } catch (cause) {
      if (isUniqueViolation(cause)) {
        return err({ code: 'ALREADY_EXISTS', message: 'A landlord with this email already exists.', cause });
      }
      return err(toPortError(cause, 'Failed to create landlord.'));
    }
  },

  async createTenantWithUnitAndLease(input: NewTenantInput): Promise<Result<TenantWithLease>> {
    try {
      const [unitId, tenantId, leaseId] = await generateUuidV7s(3);
      if (!unitId || !tenantId || !leaseId) {
        return err({ code: 'DB_ERROR', message: 'Failed to generate ids.' });
      }

      const [unitRows, tenantRows, leaseRows] = await db.batch([
        db
          .insert(units)
          .values({ id: unitId, landlordId: input.landlordId, label: input.unitLabel })
          .returning(),
        db
          .insert(tenants)
          .values({
            id: tenantId,
            landlordId: input.landlordId,
            name: input.name,
            email: input.email,
            phone: input.phone,
            invitationStatus: 'pending',
          })
          .returning(),
        db
          .insert(leases)
          .values({
            id: leaseId,
            unitId,
            tenantId,
            startDate: input.leaseStartDate,
            endDate: input.leaseEndDate ?? null,
            rentAmountPaise: input.rentAmountPaise,
            status: 'active',
          })
          .returning(),
      ]);

      const unitRow = unitRows[0];
      const tenantRow = tenantRows[0];
      const leaseRow = leaseRows[0];
      if (!unitRow || !tenantRow || !leaseRow) {
        return err({ code: 'DB_ERROR', message: 'Tenant/unit/lease insert returned no row.' });
      }

      return ok({ tenant: toTenant(tenantRow), unit: toUnit(unitRow), lease: toLease(leaseRow) });
    } catch (cause) {
      if (isUniqueViolation(cause)) {
        return err({ code: 'ALREADY_EXISTS', message: 'A tenant with this email already exists.', cause });
      }
      return err(toPortError(cause, 'Failed to create tenant/unit/lease.'));
    }
  },

  async getTenantById(id): Promise<Result<TenantWithLease | null>> {
    try {
      const rows = await db
        .select({ tenant: tenants, unit: units, lease: leases })
        .from(tenants)
        .innerJoin(leases, eq(leases.tenantId, tenants.id))
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(eq(tenants.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return ok(null);
      return ok({ tenant: toTenant(row.tenant), unit: toUnit(row.unit), lease: toLease(row.lease) });
    } catch (cause) {
      return err(toPortError(cause, 'Failed to look up tenant.'));
    }
  },

  async listTenantsByLandlord(landlordId): Promise<Result<TenantWithLease[]>> {
    try {
      const rows = await db
        .select({ tenant: tenants, unit: units, lease: leases })
        .from(tenants)
        .innerJoin(leases, eq(leases.tenantId, tenants.id))
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(eq(tenants.landlordId, landlordId))
        .orderBy(tenants.createdAt);
      return ok(
        rows.map((row) => ({
          tenant: toTenant(row.tenant),
          unit: toUnit(row.unit),
          lease: toLease(row.lease),
        })),
      );
    } catch (cause) {
      return err(toPortError(cause, 'Failed to list tenants.'));
    }
  },

  async updateTenantContact(id, patch: TenantContactPatch): Promise<Result<Tenant>> {
    try {
      // Conditional on an active lease, locked FOR SHARE so an edit racing
      // "End tenancy" waits for it to commit and then re-checks (CAP-8).
      const rows = await db
        .update(tenants)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(tenants.id, id),
            sql`exists (select 1 from ${leases} where ${leases.tenantId} = ${id} and ${leases.status} = 'active' for share)`,
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) {
        const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id)).limit(1);
        if (existing[0]) return err({ code: 'LEASE_ENDED', message: 'Tenancy has ended.' });
        return err({ code: 'NOT_FOUND', message: 'Tenant not found.' });
      }
      return ok(toTenant(row));
    } catch (cause) {
      return err(toPortError(cause, 'Failed to update tenant contact.'));
    }
  },

  async listTenanciesByAuthUserId(authUserId): Promise<Result<TenantWithLease[]>> {
    try {
      const rows = await db
        .select({ tenant: tenants, unit: units, lease: leases })
        .from(tenants)
        .innerJoin(leases, eq(leases.tenantId, tenants.id))
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(eq(tenants.authUserId, authUserId));
      return ok(
        rows.map((row) => ({
          tenant: toTenant(row.tenant),
          unit: toUnit(row.unit),
          lease: toLease(row.lease),
        })),
      );
    } catch (cause) {
      return err(toPortError(cause, 'Failed to look up tenancies for user.'));
    }
  },

  async invalidatePendingInvitationTokens(tenantId): Promise<Result<void>> {
    try {
      await db
        .update(invitationTokens)
        .set({ usedAt: new Date() })
        .where(sql`${invitationTokens.tenantId} = ${tenantId} and ${isNull(invitationTokens.usedAt)}`);
      return ok(undefined);
    } catch (cause) {
      return err(toPortError(cause, 'Failed to invalidate previous invitation tokens.'));
    }
  },

  async createInvitationToken(input): Promise<Result<InvitationToken>> {
    try {
      // INSERT ... SELECT from the tenant's *active* lease, FOR SHARE: if
      // "End tenancy" holds the lease row, this waits for it to commit and
      // then re-checks `status` (READ COMMITTED re-evaluation), so a resend
      // racing End can never leave a valid token behind. If this commits
      // first, End's own token invalidation (a later statement in its
      // batch) sees and invalidates the new token.
      const result = await db.execute<{
        id: string;
        tenant_id: string;
        token_hash: string;
        expires_at: unknown;
        used_at: unknown;
        created_at: unknown;
      }>(sql`
        insert into ${invitationTokens} (id, tenant_id, token_hash, expires_at)
        select uuidv7(), ${leases.tenantId}, ${input.tokenHash}, ${input.expiresAt.toISOString()}::timestamptz
        from ${leases}
        where ${leases.tenantId} = ${input.tenantId} and ${leases.status} = 'active'
        limit 1
        for share
        returning id, tenant_id, token_hash, expires_at, used_at, created_at
      `);
      const row = result.rows[0];
      if (!row) return err({ code: 'LEASE_ENDED', message: 'Tenancy has ended.' });
      return ok({
        id: row.id,
        tenantId: row.tenant_id,
        tokenHash: row.token_hash,
        expiresAt: toDate(row.expires_at),
        usedAt: row.used_at == null ? null : toDate(row.used_at),
        createdAt: toDate(row.created_at),
      });
    } catch (cause) {
      return err(toPortError(cause, 'Failed to create invitation token.'));
    }
  },

  async endLease({ leaseId, endDate, endedBy }) {
    try {
      // One `db.batch` = one server-side transaction on neon-http (no
      // interactive transactions). All four statements commit or none do:
      // a failure leaves the lease active and tokens/sessions untouched.
      //
      // Deliberate repository -> auth-table crossing: Better Auth's
      // `session` rows live in the same Neon DB, and deleting them here is
      // what makes lease-end and revocation atomic (AD-6). Better Auth
      // reads the session from the DB on every request (cookieCache off),
      // so a deleted row means the next request has no session.
      const [endedRows, , , finalRows] = await db.batch([
        db
          .update(leases)
          .set({
            status: 'ended',
            endDate,
            endedAt: sql`now()`,
            endedBy,
            updatedAt: sql`now()`,
          })
          .where(and(eq(leases.id, leaseId), eq(leases.status, 'active')))
          .returning(),
        db
          .update(invitationTokens)
          .set({ usedAt: sql`now()` })
          .where(
            and(
              isNull(invitationTokens.usedAt),
              inArray(
                invitationTokens.tenantId,
                db.select({ tenantId: leases.tenantId }).from(leases).where(eq(leases.id, leaseId)),
              ),
            ),
          ),
        // Keyed on the tenant's *current* auth user, resolved inside this
        // transaction (not a value read before it), so a tenant linked
        // concurrently still loses their sessions. Missing lease or unlinked
        // tenant: the subquery yields nothing and nothing is deleted.
        db.delete(authSession).where(
          inArray(
            authSession.userId,
            db
              .select({ authUserId: sql<string>`${tenants.authUserId}` })
              .from(tenants)
              .innerJoin(leases, eq(leases.tenantId, tenants.id))
              .where(eq(leases.id, leaseId)),
          ),
        ),
        db.select().from(leases).where(eq(leases.id, leaseId)).limit(1),
      ]);
      const finalRow = finalRows[0];
      if (!finalRow) return err({ code: 'NOT_FOUND', message: 'Lease not found.' });
      return ok({ outcome: endedRows.length > 0 ? 'ended' : 'already_ended', lease: toLease(finalRow) });
    } catch (cause) {
      return err(toPortError(cause, 'Failed to end tenancy.'));
    }
  },

  async reserveExport(leaseId): Promise<Result<TenancyExport>> {
    try {
      // Reserve-first: every concurrent caller converges on one row (one
      // key, one generatedAt). The key is random and carries no personal
      // data; it is kept in the DB so the object can be found and deleted
      // on a future DPDP deletion request -- do not optimize it away.
      const objectKey = `tenancy-exports/${randomBytes(16).toString('hex')}.csv`;
      const [, rows] = await db.batch([
        db
          .insert(tenancyExports)
          .values({ leaseId, objectKey, generatedAt: sql`now()`, uploadedAt: null })
          .onConflictDoNothing({ target: tenancyExports.leaseId }),
        db.select().from(tenancyExports).where(eq(tenancyExports.leaseId, leaseId)).limit(1),
      ]);
      const row = rows[0];
      if (!row) return err({ code: 'DB_ERROR', message: 'Export reservation returned no row.' });
      return ok(toTenancyExport(row));
    } catch (cause) {
      return err(toPortError(cause, 'Failed to reserve tenancy export.'));
    }
  },

  async markExportUploaded(exportId): Promise<Result<void>> {
    try {
      await db
        .update(tenancyExports)
        .set({ uploadedAt: sql`now()` })
        .where(and(eq(tenancyExports.id, exportId), isNull(tenancyExports.uploadedAt)));
      return ok(undefined);
    } catch (cause) {
      return err(toPortError(cause, 'Failed to mark export uploaded.'));
    }
  },

  async markExportSent(exportId): Promise<Result<void>> {
    try {
      await db.update(tenancyExports).set({ lastSentAt: sql`now()` }).where(eq(tenancyExports.id, exportId));
      return ok(undefined);
    } catch (cause) {
      return err(toPortError(cause, 'Failed to mark export sent.'));
    }
  },
};
