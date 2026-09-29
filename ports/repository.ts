import type {
  InvitationToken,
  Landlord,
  NewLandlordInput,
  NewTenantInput,
  Tenant,
  TenantContactPatch,
  TenantWithLease,
  Lease,
} from '@/core/identity/types';
import type { EndLeaseOutcome, TenancyExport } from '@/core/tenancy/types';
import type { Result } from './result';

/**
 * Persistence port core depends on for the landlord/tenant/unit/lease
 * domain (AD-1). adapters/db implements this against Drizzle/Postgres;
 * core never imports Drizzle directly.
 */
export interface RepositoryPort {
  // --- Landlord ---
  getLandlordByEmail(email: string): Promise<Result<Landlord | null>>;
  createLandlord(input: NewLandlordInput): Promise<Result<Landlord>>;

  // --- Tenant / unit / lease ---
  /** Creates the tenant, its unit, and its lease as one atomic operation. */
  createTenantWithUnitAndLease(input: NewTenantInput): Promise<Result<TenantWithLease>>;
  getTenantById(id: string): Promise<Result<TenantWithLease | null>>;
  listTenantsByLandlord(landlordId: string): Promise<Result<TenantWithLease[]>>;
  /**
   * Updates only the on-file contact record. Never touches Better Auth's
   * own user/account/session tables -- an already-activated tenant's login
   * identifier is unaffected by this (I/O matrix: "Update tenant contact
   * info"). Conditional on an active lease: returns a `LEASE_ENDED`
   * error once the tenancy has ended (CAP-8), even when racing End.
   */
  updateTenantContact(id: string, patch: TenantContactPatch): Promise<Result<Tenant>>;
  /**
   * Every tenant (with lease) whose `authUserId` is this Better Auth user
   * id. Used by `resolveTenantAccess` (CAP-8 access guarantee).
   */
  listTenanciesByAuthUserId(authUserId: string): Promise<Result<TenantWithLease[]>>;

  // --- Invitation tokens ---
  /** Marks every not-yet-used token for this tenant as invalidated (used up without ever being consumed). */
  invalidatePendingInvitationTokens(tenantId: string): Promise<Result<void>>;
  /**
   * Creates the token only while the tenant has an active lease, checked
   * and locked in the same statement so a concurrent End cannot slip in
   * between. Returns a `LEASE_ENDED` error when no active lease exists.
   */
  createInvitationToken(input: { tenantId: string; tokenHash: string; expiresAt: Date }): Promise<Result<InvitationToken>>;

  // --- Tenancy end (CAP-8, AD-6) ---
  /**
   * One atomic operation: flips an active lease to `ended` (recording the
   * move-out date, `endedAt = now()`, `endedBy`), invalidates every pending
   * invitation token for its tenant, and deletes every live auth session of
   * the tenant's current `authUserId` (resolved from `leaseId` in the same
   * transaction). `already_ended` when the lease was not
   * active -- the token/session revoke still re-runs (idempotent).
   * Returns the lease as stored after the operation.
   */
  endLease(input: {
    leaseId: string;
    endDate: Date;
    endedBy: string;
  }): Promise<Result<{ outcome: EndLeaseOutcome; lease: Lease }>>;
  /**
   * Inserts the lease's single export row if absent (fresh random key,
   * `generatedAt = now()`, `uploadedAt = null`) and returns whichever row
   * exists -- every concurrent caller converges on the same row.
   */
  reserveExport(leaseId: string): Promise<Result<TenancyExport>>;
  markExportUploaded(exportId: string): Promise<Result<void>>;
  markExportSent(exportId: string): Promise<Result<void>>;
}
