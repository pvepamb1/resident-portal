'use client';

import { useActionState, useState } from 'react';
import { updateTenantContactAction, type ActionState } from './actions';
import type { Tenant } from '@/core/identity/types';

const initialState: ActionState = { status: 'idle' };

export function EditTenantForm({ tenant }: { tenant: Pick<Tenant, 'id' | 'name' | 'email' | 'phone'> }) {
  const [open, setOpen] = useState(false);
  const boundAction = updateTenantContactAction.bind(null, tenant.id);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Edit contact info
      </button>
    );
  }

  return (
    <form action={formAction} style={{ display: 'grid', gap: '0.4rem', marginTop: '0.5rem' }}>
      <label>
        Name
        <input name="name" defaultValue={tenant.name} required />
      </label>
      <label>
        Email
        <input name="email" type="email" defaultValue={tenant.email} required />
      </label>
      <label>
        Phone
        <input name="phone" type="tel" defaultValue={tenant.phone} required />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {state.status !== 'idle' && (
        <p role="status" style={{ color: state.status === 'error' ? '#a33' : '#2a6', fontSize: '0.85rem' }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
