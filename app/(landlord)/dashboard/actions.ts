'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authPort } from '@/adapters/auth/auth-port';
import { createR2ObjectStorageFromEnv } from '@/adapters/db/r2-object-storage';
import { emptyPaymentHistoryReader } from '@/adapters/db/empty-payment-history';
import { drizzleRepository } from '@/adapters/db/repository';
import { createNotifierFromEnv } from '@/adapters/notify';
import { addTenant, updateTenantContact } from '@/core/identity/tenant';
import { resendInvitation } from '@/core/identity/invitation';
import type { TenantWithLease } from '@/core/identity/types';
import { consoleJsonLogger } from '@/core/shared/logger';
import { endTenancy, sendTenancyExport, type TenancyDeps } from '@/core/tenancy/end-tenancy';
import type { DashboardNotice } from './notices';
import { requireLandlord, requireLandlordSession } from './require-landlord';

const notifier = createNotifierFromEnv();
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

const tenancyDeps: TenancyDeps = {
  repository: drizzleRepository,
  auth: authPort,
  storage: createR2ObjectStorageFromEnv(),
  paymentHistory: emptyPaymentHistoryReader,
  notifier,
  logger: consoleJsonLogger,
};

const TENANCY_ENDED_MESSAGE = 'Tenancy has ended.';

export interface ActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Set when the error belongs to a specific form field. */
  field?: string;
}

/** Loads a tenant only if it belongs to this landlord (same answer for "missing" and "not yours"). */
async function loadOwnedTenant(
  tenantId: string,
  landlordId: string,
): Promise<{ ok: true; value: TenantWithLease } | { ok: false; state: ActionState }> {
  const existing = await drizzleRepository.getTenantById(tenantId);
  if (!existing.ok) return { ok: false, state: { status: 'error', message: existing.error.message } };
  if (!existing.value || existing.value.tenant.landlordId !== landlordId) {
    return { ok: false, state: { status: 'error', message: 'Tenant not found.' } };
  }
  return { ok: true, value: existing.value };
}

export async function addTenantAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const landlord = await requireLandlord();

  const rentAmountRupees = Number(formData.get('rentAmountRupees'));
  const leaseStartDateRaw = String(formData.get('leaseStartDate') ?? '');

  const result = await addTenant(
    { repository: drizzleRepository, notifier, appBaseUrl },
    {
      landlordId: landlord.id,
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      unitLabel: String(formData.get('unitLabel') ?? ''),
      leaseStartDate: leaseStartDateRaw ? new Date(leaseStartDateRaw) : new Date(),
      rentAmountPaise: Number.isFinite(rentAmountRupees) ? Math.round(rentAmountRupees * 100) : 0,
    },
  );

  if (!result.ok) {
    return { status: 'error', message: result.error.message };
  }

  revalidatePath('/dashboard');
  return { status: 'success', message: `${result.value.tenant.name} added and invited.` };
}

export async function resendInvitationAction(tenantId: string): Promise<ActionState> {
  const landlord = await requireLandlord();

  const existing = await loadOwnedTenant(tenantId, landlord.id);
  if (!existing.ok) return existing.state;

  const result = await resendInvitation({ repository: drizzleRepository, notifier, appBaseUrl }, existing.value);

  if (!result.ok) {
    return { status: 'error', message: result.error.message };
  }

  revalidatePath('/dashboard');

  if (result.value.kind === 'already_active') {
    return { status: 'error', message: 'This tenant has already activated their account -- nothing to resend.' };
  }
  if (result.value.kind === 'lease_ended') {
    return { status: 'error', message: TENANCY_ENDED_MESSAGE };
  }
  return { status: 'success', message: 'Invitation re-sent.' };
}

export async function updateTenantContactAction(
  tenantId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const landlord = await requireLandlord();

  const existing = await loadOwnedTenant(tenantId, landlord.id);
  if (!existing.ok) return existing.state;

  const name = formData.get('name');
  const email = formData.get('email');
  const phone = formData.get('phone');

  const result = await updateTenantContact(drizzleRepository, tenantId, {
    ...(name !== null ? { name: String(name) } : {}),
    ...(email !== null ? { email: String(email) } : {}),
    ...(phone !== null ? { phone: String(phone) } : {}),
  });

  if (!result.ok) {
    revalidatePath('/dashboard');
    return { status: 'error', message: result.error.message };
  }

  revalidatePath('/dashboard');
  return { status: 'success', message: 'Tenant contact info updated.' };
}

export async function endTenancyAction(
  tenantId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { landlord, authUserId } = await requireLandlordSession();

  const result = await endTenancy(tenancyDeps, {
    tenantId,
    landlordId: landlord.id,
    actingUserId: authUserId,
    endDate: String(formData.get('endDate') ?? ''),
  });

  // The lease may have ended even when a later step failed -- always refresh.
  revalidatePath('/dashboard');

  // Once the lease is ended the row moves to "Past tenancies" and this form
  // unmounts, so the outcome is shown as a page banner instead of inline.
  let notice: DashboardNotice | null = null;
  if (result.ok) notice = result.value.kind === 'ended' ? 'tenancy_ended' : 'tenancy_already_ended';
  else if (result.error.code === 'EXPORT_DELIVERY_FAILED') notice = 'export_delivery_failed';
  if (notice) redirect(`/dashboard?notice=${notice}`);

  if (!result.ok) {
    return {
      status: 'error',
      message: result.error.message,
      ...(result.error.code === 'VALIDATION' ? { field: 'endDate' } : {}),
    };
  }
  return { status: 'idle' };
}

export async function sendTenancyExportAction(tenantId: string): Promise<ActionState> {
  const { landlord, authUserId } = await requireLandlordSession();

  const result = await sendTenancyExport(tenancyDeps, {
    tenantId,
    landlordId: landlord.id,
    actingUserId: authUserId,
  });

  revalidatePath('/dashboard');

  if (!result.ok) {
    return { status: 'error', message: result.error.message };
  }
  return { status: 'success', message: 'Payment history emailed to the tenant.' };
}
