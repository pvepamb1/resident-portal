'use client';

import { useState, useTransition } from 'react';
import { resendInvitationAction } from './actions';

export function ResendInvitationButton({ tenantId }: { tenantId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await resendInvitationAction(tenantId);
            setMessage(result.message ?? null);
          });
        }}
      >
        {isPending ? 'Sending…' : 'Resend invitation'}
      </button>
      {message && (
        <p role="status" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
          {message}
        </p>
      )}
    </div>
  );
}
