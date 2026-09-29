import type { PaymentHistoryReader } from '@/ports/payment-history';
import { ok } from '@/ports/result';

/**
 * Placeholder PaymentHistoryReader: payment tables arrive in Stories 4/6,
 * which replace this adapter without touching core/tenancy. Until then a
 * tenancy's history is genuinely empty.
 */
export const emptyPaymentHistoryReader: PaymentHistoryReader = {
  async listForLease() {
    return ok([]);
  },
};
