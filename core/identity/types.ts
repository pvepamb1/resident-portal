/**
 * Domain types for the landlord/tenant/unit/lease core-entity ERD
 * (ARCHITECTURE-SPINE.md "Core entities"). These are core's public types --
 * ports and adapters import from here, never the other way around (AD-1).
 */

export type InvitationStatus = 'pending' | 'active';

export interface Landlord {
  id: string;
  /** Normalized (case-folded) email -- the allowlisted identity. */
  email: string;
  /** Normalized E.164 phone, if the landlord also authenticates via phone+OTP. */
  phone: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Unit {
  id: string;
  landlordId: string;
  /** Free-text label/address for the unit, e.g. "Flat 3B, Whitefield". */
  label: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tenant {
  id: string;
  landlordId: string;
  name: string;
  /** Normalized (case-folded) email on file -- used for future identity resolution (AD-5), not necessarily the login identifier. */
  email: string;
  /** Normalized E.164 phone on file. */
  phone: string;
  invitationStatus: InvitationStatus;
  /**
   * Better Auth user id this tenant resolved to, once they activate their
   * account (Story 3 / CAP-6). Null until then. Editing `email`/`phone`
   * above never changes this -- an already-activated tenant's login
   * identity is independent of the on-file contact record.
   */
  authUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LeaseStatus = 'active' | 'ended';

export interface Lease {
  id: string;
  unitId: string;
  tenantId: string;
  startDate: Date;
  endDate: Date | null;
  /** Rent amount in paise (integer) to avoid floating-point money bugs. */
  rentAmountPaise: number;
  status: LeaseStatus;
  /** When the tenancy was ended (CAP-8) -- the moment of the action, not the move-out date (`endDate`). */
  endedAt: Date | null;
  /** Landlord id that ended the tenancy (CAP-8 audit). */
  endedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantWithLease {
  tenant: Tenant;
  unit: Unit;
  lease: Lease;
}

export interface InvitationToken {
  id: string;
  tenantId: string;
  /** SHA-256 hex digest of the raw token -- the raw token is never persisted. */
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface NewLandlordInput {
  email: string;
  phone?: string | null;
  name: string;
}

export interface NewTenantInput {
  landlordId: string;
  name: string;
  email: string;
  phone: string;
  unitLabel: string;
  leaseStartDate: Date;
  leaseEndDate?: Date | null;
  rentAmountPaise: number;
}

export interface TenantContactPatch {
  name?: string;
  email?: string;
  phone?: string;
}
