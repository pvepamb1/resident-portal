import { eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { invitationTokens, leases, tenants, units, landlords } from '@/db/schema';
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
      const rows = await db
        .update(tenants)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();
      const row = rows[0];
      if (!row) return err({ code: 'NOT_FOUND', message: 'Tenant not found.' });
      return ok(toTenant(row));
    } catch (cause) {
      return err(toPortError(cause, 'Failed to update tenant contact.'));
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
      const [id] = await generateUuidV7s(1);
      const rows = await db
        .insert(invitationTokens)
        .values({ id, tenantId: input.tenantId, tokenHash: input.tokenHash, expiresAt: input.expiresAt })
        .returning();
      const row = rows[0];
      if (!row) return err({ code: 'DB_ERROR', message: 'Insert returned no row.' });
      return ok(toInvitationToken(row));
    } catch (cause) {
      return err(toPortError(cause, 'Failed to create invitation token.'));
    }
  },
};
