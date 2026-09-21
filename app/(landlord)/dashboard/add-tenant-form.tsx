'use client';

import { useActionState } from 'react';
import { addTenantAction, type ActionState } from './actions';

const initialState: ActionState = { status: 'idle' };

export function AddTenantForm() {
  const [state, formAction, pending] = useActionState(addTenantAction, initialState);

  return (
    <form action={formAction} style={{ display: 'grid', gap: '0.5rem', maxWidth: 420 }}>
      <h2>Add tenant</h2>
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Phone
        <input name="phone" type="tel" required placeholder="+91 98765 43210" />
      </label>
      <label>
        Unit
        <input name="unitLabel" required placeholder="Flat 3B, Whitefield" />
      </label>
      <label>
        Lease start date
        <input name="leaseStartDate" type="date" required />
      </label>
      <label>
        Monthly rent (INR)
        <input name="rentAmountRupees" type="number" min="1" step="1" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add tenant and send invitation'}
      </button>
      {state.status !== 'idle' && (
        <p role="status" style={{ color: state.status === 'error' ? '#a33' : '#2a6' }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
