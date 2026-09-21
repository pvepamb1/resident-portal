import type {
  InvitationToken,
  Landlord,
  NewLandlordInput,
  NewTenantInput,
  Tenant,
  TenantContactPatch,
  TenantWithLease,
} from '@/core/identity/types';
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
   * info").
   */
  updateTenantContact(id: string, patch: TenantContactPatch): Promise<Result<Tenant>>;

  // --- Invitation tokens ---
  /** Marks every not-yet-used token for this tenant as invalidated (used up without ever being consumed). */
  invalidatePendingInvitationTokens(tenantId: string): Promise<Result<void>>;
  createInvitationToken(input: { tenantId: string; tokenHash: string; expiresAt: Date }): Promise<Result<InvitationToken>>;
}
