import { ALREADY_ENDED_MESSAGE } from '@/core/tenancy/end-tenancy';

/**
 * Fixed allowlist of `?notice=` codes the dashboard renders as a banner.
 * Anything else in the query string renders nothing.
 */
export const DASHBOARD_NOTICES = {
  tenancy_ended: {
    tone: 'success',
    message: 'Tenancy ended, access revoked, and payment history emailed to the tenant.',
  },
  tenancy_already_ended: { tone: 'error', message: ALREADY_ENDED_MESSAGE },
  export_delivery_failed: {
    tone: 'error',
    message:
      'Tenancy ended and access revoked, but the payment-history export could not be sent. Use Send export to retry.',
  },
} as const;

export type DashboardNotice = keyof typeof DASHBOARD_NOTICES;

export function lookupNotice(code: unknown): (typeof DASHBOARD_NOTICES)[DashboardNotice] | null {
  return typeof code === 'string' && Object.hasOwn(DASHBOARD_NOTICES, code)
    ? DASHBOARD_NOTICES[code as DashboardNotice]
    : null;
}
