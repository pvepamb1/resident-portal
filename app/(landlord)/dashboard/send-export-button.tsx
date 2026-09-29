'use client';

import { useState, useTransition } from 'react';
import { sendTenancyExportAction, type ActionState } from './actions';

/** Re-sends the one stored payment-history snapshot as an email attachment. */
export function SendExportButton({ tenantId }: { tenantId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  const isError = result?.status === 'error';

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            setResult(await sendTenancyExportAction(tenantId));
          });
        }}
      >
        {isPending ? 'Sending…' : 'Send export'}
      </button>
      {result?.message && (
        <p
          role={isError ? 'alert' : 'status'}
          style={{ fontSize: '0.85rem', margin: '0.25rem 0 0', color: isError ? '#a33' : '#2a6' }}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
