'use client';

import { useActionState, useState } from 'react';
import { endTenancyAction, type ActionState } from './actions';

const initialState: ActionState = { status: 'idle' };

/**
 * Two-step "End tenancy": the first click only reveals the confirm step
 * (move-out date + explicit confirmation), so a stray click never ends a
 * tenancy. The submit button disables while pending; the server still
 * handles double-submits (exactly one transition, one email).
 */
export function EndTenancyForm({
  tenantId,
  tenantName,
  todayIst,
  leaseStartIst,
}: {
  tenantId: string;
  tenantName: string;
  /** Today's date in IST (YYYY-MM-DD), computed on the server. */
  todayIst: string;
  /** Lease start date in IST (YYYY-MM-DD) -- the earliest allowed move-out date. */
  leaseStartIst: string;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = endTenancyAction.bind(null, tenantId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        End tenancy
      </button>
    );
  }

  return (
    <form action={formAction} style={{ display: 'grid', gap: '0.4rem', marginTop: '0.5rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem' }}>
        End {tenantName}&apos;s tenancy? Their portal access is revoked immediately and they are emailed a
        one-time copy of their payment history. This cannot be undone.
      </p>
      <label>
        Move-out date
        <input
          name="endDate"
          type="date"
          defaultValue={todayIst}
          min={leaseStartIst}
          max={todayIst}
          required
          aria-invalid={state.field === 'endDate' || undefined}
        />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={pending}>
          {pending ? 'Ending…' : 'Confirm end tenancy'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
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
