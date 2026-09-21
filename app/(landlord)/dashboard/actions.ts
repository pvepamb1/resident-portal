'use server';

import { revalidatePath } from 'next/cache';
import { drizzleRepository } from '@/adapters/db/repository';
import { createNotifierFromEnv } from '@/adapters/notify';
import { addTenant, updateTenantContact } from '@/core/identity/tenant';
import { resendInvitation } from '@/core/identity/invitation';
import { requireLandlord } from './require-landlord';

const notifier = createNotifierFromEnv();
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

export interface ActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
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
  await requireLandlord();

  const existing = await drizzleRepository.getTenantById(tenantId);
  if (!existing.ok) {
    return { status: 'error', message: existing.error.message };
  }
  if (!existing.value) {
    return { status: 'error', message: 'Tenant not found.' };
  }

  const result = await resendInvitation(
    { repository: drizzleRepository, notifier, appBaseUrl },
    existing.value.tenant,
  );

  if (!result.ok) {
    return { status: 'error', message: result.error.message };
  }

  revalidatePath('/dashboard');

  if (result.value.kind === 'already_active') {
    return { status: 'error', message: 'This tenant has already activated their account -- nothing to resend.' };
  }
  return { status: 'success', message: 'Invitation re-sent.' };
}

export async function updateTenantContactAction(
  tenantId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireLandlord();

  const name = formData.get('name');
  const email = formData.get('email');
  const phone = formData.get('phone');

  const result = await updateTenantContact(drizzleRepository, tenantId, {
    ...(name !== null ? { name: String(name) } : {}),
    ...(email !== null ? { email: String(email) } : {}),
    ...(phone !== null ? { phone: String(phone) } : {}),
  });

  if (!result.ok) {
    return { status: 'error', message: result.error.message };
  }

  revalidatePath('/dashboard');
  return { status: 'success', message: 'Tenant contact info updated.' };
}
