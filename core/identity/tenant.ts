import type { RepositoryPort } from '@/ports/repository';
import type { Notifier } from '@/ports/notifier';
import { err, ok, type PortError, type Result } from '@/ports/result';
import { normalizeEmail, normalizePhone } from './normalize';
import { issueInvitationToken } from './invitation';
import { buildInvitationEmail } from './invitation-email';
import type { Tenant, TenantContactPatch, TenantWithLease } from './types';

export interface AddTenantFormInput {
  landlordId: string;
  name: string;
  email: string;
  phone: string;
  unitLabel: string;
  leaseStartDate: Date;
  leaseEndDate?: Date | null;
  rentAmountPaise: number;
}

export interface ValidationError {
  code: 'VALIDATION';
  field: 'name' | 'email' | 'phone' | 'unitLabel' | 'rentAmountPaise' | 'leaseStartDate' | 'contact';
  message: string;
}

/**
 * Add-tenant flow (I/O matrix: "Add tenant"). Validates and normalizes
 * every identifier before anything is persisted (AD-5), creates the
 * tenant/unit/lease together, then issues and emails the one-time
 * invitation -- the Notifier call happens only after the repository write
 * has committed (AD-1).
 */
export async function addTenant(
  deps: { repository: RepositoryPort; notifier: Notifier; appBaseUrl: string },
  input: AddTenantFormInput,
): Promise<Result<TenantWithLease, ValidationError | PortError>> {
  const name = input.name.trim();
  if (name.length === 0) {
    return err({ code: 'VALIDATION', field: 'name', message: 'Name is required.' });
  }

  const email = normalizeEmail(input.email);
  if (!email) {
    return err({ code: 'VALIDATION', field: 'email', message: 'Enter a valid email address.' });
  }

  const phone = normalizePhone(input.phone);
  if (!phone) {
    return err({ code: 'VALIDATION', field: 'phone', message: 'Enter a valid phone number.' });
  }

  const unitLabel = input.unitLabel.trim();
  if (unitLabel.length === 0) {
    return err({ code: 'VALIDATION', field: 'unitLabel', message: 'Unit is required.' });
  }

  if (!(input.leaseStartDate instanceof Date) || Number.isNaN(input.leaseStartDate.getTime())) {
    return err({ code: 'VALIDATION', field: 'leaseStartDate', message: 'Enter a valid lease start date.' });
  }

  if (!Number.isInteger(input.rentAmountPaise) || input.rentAmountPaise <= 0) {
    return err({
      code: 'VALIDATION',
      field: 'rentAmountPaise',
      message: 'Rent amount must be a positive whole number of paise.',
    });
  }

  const created = await deps.repository.createTenantWithUnitAndLease({
    landlordId: input.landlordId,
    name,
    email,
    phone,
    unitLabel,
    leaseStartDate: input.leaseStartDate,
    leaseEndDate: input.leaseEndDate ?? null,
    rentAmountPaise: input.rentAmountPaise,
  });
  if (!created.ok) return created;

  const issued = await issueInvitationToken(deps.repository, created.value.tenant.id);
  if (!issued.ok) {
    // The tenant/unit/lease already exist even though issuing the
    // invitation failed -- surface the error rather than silently leaving
    // the tenant un-invited; the landlord can retry via "resend invitation".
    return issued;
  }

  const email_ = buildInvitationEmail({
    tenant: created.value.tenant,
    token: issued.value.token,
    appBaseUrl: deps.appBaseUrl,
  });
  const sent = await deps.notifier.sendEmail({ to: created.value.tenant.email, ...email_ });
  if (!sent.ok) return sent;

  return ok(created.value);
}

/**
 * Update-tenant-contact flow (I/O matrix: "Update tenant contact info").
 * Only ever touches the on-file record via the repository port -- never
 * Better Auth's own user/account tables -- so an already-activated
 * tenant's login identifier is unaffected by this edit.
 */
export async function updateTenantContact(
  repository: RepositoryPort,
  tenantId: string,
  patch: TenantContactPatch,
): Promise<Result<Tenant, ValidationError | PortError>> {
  const normalized: TenantContactPatch = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) {
      return err({ code: 'VALIDATION', field: 'name', message: 'Name is required.' });
    }
    normalized.name = name;
  }

  if (patch.email !== undefined) {
    const email = normalizeEmail(patch.email);
    if (!email) {
      return err({ code: 'VALIDATION', field: 'email', message: 'Enter a valid email address.' });
    }
    normalized.email = email;
  }

  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone);
    if (!phone) {
      return err({ code: 'VALIDATION', field: 'phone', message: 'Enter a valid phone number.' });
    }
    normalized.phone = phone;
  }

  if (Object.keys(normalized).length === 0) {
    return err({ code: 'VALIDATION', field: 'contact', message: 'Provide at least one field to update.' });
  }

  return repository.updateTenantContact(tenantId, normalized);
}
