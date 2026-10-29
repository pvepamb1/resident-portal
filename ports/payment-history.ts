import type { PaymentHistoryEntry } from '@/core/tenancy/types';
import type { Result } from './result';

/**
 * Read side of a lease's payment history, as consumed by the CAP-8 export.
 * Stories 4/6 swap the adapter (payment tables don't exist yet) without
 * touching core/tenancy.
 */
export interface PaymentHistoryReader {
  /** Oldest first. */
  listForLease(leaseId: string): Promise<Result<PaymentHistoryEntry[]>>;
}
