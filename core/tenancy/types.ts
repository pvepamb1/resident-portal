/**
 * Core public types for the tenancy lifecycle (CAP-8, AD-6). Ports and
 * adapters import from here, never the other way around (AD-1).
 */

/**
 * One row of a tenancy's payment history as the export needs it. Stories
 * 4/6 supply real rows via their own `PaymentHistoryReader` adapter.
 */
export interface PaymentHistoryEntry {
  /** When the payment happened (UTC instant; rendered as an IST date). */
  paidAt: Date;
  /** Integer paise. May be negative (e.g. a future refund row). */
  amountPaise: number;
  /** Free text from the payment layer, e.g. "captured" / "refunded". */
  status: string;
  /** Free-text gateway/bank reference. */
  reference: string;
}

/** The one point-in-time snapshot row per lease (`tenancy_exports`). */
export interface TenancyExport {
  id: string;
  leaseId: string;
  /** `tenancy-exports/<random 32-hex>.csv` -- carries no personal data. */
  objectKey: string;
  generatedAt: Date;
  /** Null until the object has actually been written to storage. */
  uploadedAt: Date | null;
  lastSentAt: Date | null;
}

export type EndLeaseOutcome = 'ended' | 'already_ended';
